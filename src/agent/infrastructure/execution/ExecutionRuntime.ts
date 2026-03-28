import type { OutboundMessage, InboundMessage, LLMMessage, LLMResponse } from '../../../types.js';
import type { PluginManager } from '../../../features/plugins/index.js';
import type { SessionManager } from '../../../features/sessions/application/SessionManager.js';
import type { SessionMemoryService } from '../memory/SessionMemoryService.js';
import type { SessionRoutingService } from '../session/SessionRoutingService.js';
import type { ExecutionContext } from './ExecutionTypes.js';
import type { ExecutionEngine } from './ExecutionEngine.js';
import type { ExecutionStatus } from '../../domain/execution.js';
import { ExecutionRegistry } from './ExecutionRegistry.js';
import { logger } from '../../../platform/observability/index.js';
import type { ExecutionPolicy } from './ExecutionTypes.js';
import type { WorkerExecutionDelegate } from '../worker/WorkerExecutionDelegate.js';
import { buildVisionUserContent, type VisionUserContent } from './ContextBuilder.js';

interface FinalizeExecutionParams {
  sessionKey: string;
  request: InboundMessage;
  content: string;
  reasoning_content?: string;
  agentMode: boolean;
  suppressOutbound?: boolean;
  requestContentForMemory?: string;
}

type VisionPreparationResult =
  | {
      ok: true;
      persistedUserContent: string;
      currentTurnContent?: VisionUserContent;
    }
  | {
      ok: false;
      message: string;
    };

export class ExecutionRuntime {
  private readonly subAgentExcludedTools = ['send_msg_to_user', 'call_agent', 'call_temp_agent'];
  private static readonly VISION_SUMMARY_REQUIRED_MESSAGE = '收到图片，但当前未配置可用的视觉回退摘要模型，无法继续处理。请先配置 visionFallbackModel 后重试。';
  private static readonly VISION_SUMMARY_FAILED_MESSAGE = '收到图片，但生成图片摘要失败，已中止本次处理。请检查视觉回退模型配置或稍后重试。';
  private static readonly IMAGE_SUMMARY_PREFIX = '图片摘要（供后续上下文使用）：';
  private static readonly IMAGE_SUMMARY_SYSTEM_PROMPT = [
    '角色: 图片内容摘要器',
    '任务: 结合用户文字与图片内容，生成一段会写入会话上下文的纯文本摘要，供后续无图回合继续理解当前任务。',
    '要求: 只描述图片中可确认的关键信息；不要臆测；如果有多张图，按要点概括差异与共同点；保留与用户当前任务直接相关的细节。',
    '输出: 仅输出摘要正文，不要使用 Markdown 标题，不要输出多余前后缀。'
  ].join('\n');
  private readonly registry: ExecutionRegistry;
  private readonly workerExecutionDelegate: WorkerExecutionDelegate;
  private readonly log = logger.child('ExecutionRuntime');

  constructor(args: {
    engine: ExecutionEngine;
    sessionRouting: SessionRoutingService;
    sessionManager: SessionManager;
    memoryService?: SessionMemoryService;
    getPluginManager: () => PluginManager | undefined;
    sendOutbound: (message: OutboundMessage) => Promise<void>;
    executionRegistry?: ExecutionRegistry;
    workerExecutionDelegate: WorkerExecutionDelegate;
  }) {
    this.engine = args.engine;
    this.sessionRouting = args.sessionRouting;
    this.sessionManager = args.sessionManager;
    this.memoryService = args.memoryService;
    this.getPluginManager = args.getPluginManager;
    this.sendOutbound = args.sendOutbound;
    this.registry = args.executionRegistry ?? new ExecutionRegistry();
    this.workerExecutionDelegate = args.workerExecutionDelegate;
  }

  private engine: ExecutionEngine;
  private sessionRouting: SessionRoutingService;
  private sessionManager: SessionManager;
  private memoryService?: SessionMemoryService;
  private getPluginManager: () => PluginManager | undefined;
  private sendOutbound: (message: OutboundMessage) => Promise<void>;

  setMemoryService(memoryService?: SessionMemoryService): void {
    this.memoryService = memoryService;
  }

  get executionRegistry(): ExecutionRegistry {
    return this.registry;
  }

  async execute(context: ExecutionContext): Promise<string | undefined> {
    let requestPersisted = false;
    let persistedRequestContent = context.request.content;
    const ensureRequestPersisted = async (): Promise<void> => {
      if (requestPersisted) {
        return;
      }

      await this.sessionManager.addMessage(context.sessionKey, 'user', persistedRequestContent);
      requestPersisted = true;
    };

    const { policy, messages } = this.engine.prepare(context);
    const executionLog = this.log.withFields({
      ssn: context.sessionKey,
      ch: context.request.channel,
      chId: context.request.chatId,
      agent: policy.roleName
    });
    executionLog.debug('执行开始', {
      source: context.toolContext.source || 'user'
    });

    if (this.hasVisionInput(context.request)) {
      const preparedVisionTurn = await this.prepareVisionTurn(context, policy, executionLog);
      if (preparedVisionTurn.ok === false) {
        const failureMessage = preparedVisionTurn.message;
        executionLog.warn('检测到图片输入，但未能完成视觉摘要预处理');

        await ensureRequestPersisted();
        await this.finalize({
          sessionKey: context.sessionKey,
          request: context.request,
          content: failureMessage,
          reasoning_content: undefined,
          agentMode: false,
          suppressOutbound: context.suppressOutbound,
          requestContentForMemory: persistedRequestContent
        });

        return failureMessage;
      }

      persistedRequestContent = preparedVisionTurn.persistedUserContent;
      if (preparedVisionTurn.currentTurnContent !== undefined) {
        this.replaceCurrentTurnContent(messages, preparedVisionTurn.currentTurnContent);
      }
    }

    const pluginManager = this.getPluginManager();

    if (pluginManager) {
      await pluginManager.runAgentBeforeTaps({
        message: context.request,
        messages
      });
    }

    await ensureRequestPersisted();
    const result = await this.executeWithWorker(policy, messages, context);

    await this.finalize({
      sessionKey: context.sessionKey,
      request: context.request,
      content: result.content,
      reasoning_content: result.reasoning_content,
      agentMode: result.agentMode,
      suppressOutbound: context.suppressOutbound,
      requestContentForMemory: persistedRequestContent
    });
    executionLog.debug('执行完成', {
      agentMode: result.agentMode
    });

    return result.content;
  }

  async runSubAgentTask(
    agentName: string,
    task: string,
    toolContext: ExecutionContext['toolContext'],
    extra?: { signal?: AbortSignal }
  ): Promise<string> {
    const prepared = this.engine.prepareSubAgentExecution(
      agentName,
      task,
      {
        ...toolContext,
        signal: extra?.signal ?? toolContext.signal
      },
      {
        excludeTools: this.subAgentExcludedTools
      }
    );

    const result = await this.workerExecutionDelegate.executeToolLoop({
      policy: prepared.policy,
      messages: prepared.messages,
      toolContext: prepared.toolContext,
      options: {
        sessionKey: toolContext.sessionKey,
        allowTools: true,
        source: 'user',
        signal: extra?.signal ?? toolContext.signal
      }
    });

    return result.content;
  }

  async runTemporarySubAgentTask(
    baseAgentName: string | undefined,
    task: string,
    systemPrompt: string,
    toolContext: ExecutionContext['toolContext'],
    extra?: { signal?: AbortSignal }
  ): Promise<string> {
    const prepared = this.engine.prepareTemporarySubAgentExecution(
      baseAgentName,
      task,
      systemPrompt,
      {
        ...toolContext,
        signal: extra?.signal ?? toolContext.signal
      },
      {
        excludeTools: this.subAgentExcludedTools
      }
    );

    const result = await this.workerExecutionDelegate.executeToolLoop({
      policy: prepared.policy,
      messages: prepared.messages,
      toolContext: prepared.toolContext,
      options: {
        sessionKey: toolContext.sessionKey,
        allowTools: true,
        source: 'user',
        signal: extra?.signal ?? toolContext.signal
      }
    });

    return result.content;
  }

  async runTemporarySubAgentTasks(
    baseAgentName: string | undefined,
    tasks: Array<{ task: string; systemPrompt: string }>,
    toolContext: ExecutionContext['toolContext'],
    extra?: { signal?: AbortSignal }
  ): Promise<Array<{ task: string; success: boolean; result?: string; error?: string }>> {
    return Promise.all(tasks.map(async ({ task, systemPrompt }) => {
      try {
        const result = await this.runTemporarySubAgentTask(baseAgentName, task, systemPrompt, toolContext, extra);
        return {
          task,
          success: true,
          result
        };
      } catch (error) {
        return {
          task,
          success: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }));
  }

  async runSubAgentTasks(
    tasks: Array<{ agentName: string; task: string }>,
    toolContext: ExecutionContext['toolContext'],
    extra?: { signal?: AbortSignal }
  ): Promise<Array<{ agentName: string; task: string; success: boolean; result?: string; error?: string }>> {
    return Promise.all(tasks.map(async ({ agentName, task }) => {
      try {
        const result = await this.runSubAgentTask(agentName, task, toolContext, extra);
        return { agentName, task, success: true, result };
      } catch (error) {
        return {
          agentName,
          task,
          success: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }));
  }

  abortBySessionKey(sessionKey: string): boolean {
    const aborted = this.registry.abort(sessionKey);
    if (aborted) {
      this.workerExecutionDelegate.abort(sessionKey);
    }
    return aborted;
  }

  abortByChat(channel: string, chatId: string): boolean {
    const sessionKey = this.sessionRouting.resolveByChannel(channel, chatId);
    if (!sessionKey) {
      return false;
    }

    const aborted = this.registry.abort(sessionKey);
    if (aborted) {
      this.workerExecutionDelegate.abort(sessionKey);
    }
    return aborted;
  }

  getStatus(sessionKey: string): ExecutionStatus {
    const current = this.registry.getHandle(sessionKey);

    return {
      sessionKey,
      current,
      active: !!current,
      channel: current?.channel,
      chatId: current?.chatId
    };
  }

  stop(): void {
    for (const handle of this.registry.listHandles()) {
      this.abortBySessionKey(handle.sessionKey);
    }
  }

  private async executeWithWorker(
    policy: ExecutionPolicy,
    messages: LLMMessage[],
    context: ExecutionContext
  ): Promise<{ content: string; reasoning_content?: string; agentMode: boolean }> {
    const controller = context.toolContext.signal
      ? undefined
      : this.registry.begin(context.sessionKey, undefined, {
          scope: 'session',
          channel: context.request.channel,
          chatId: context.request.chatId,
          startedAt: new Date()
        });
    const signal = context.toolContext.signal ?? controller?.signal;

    try {
      return await this.workerExecutionDelegate.executeToolLoop({
        policy,
        messages,
        toolContext: {
          ...context.toolContext,
          signal
        },
        onSpawn: ({ executionId, childPid }) => {
          this.log.withFields({
            ssn: context.sessionKey,
            ch: context.request.channel,
            chId: context.request.chatId,
            agent: policy.roleName,
            executionId,
            childPid: childPid ?? null,
            model: policy.model
          }).info('首轮消息已进入 worker 执行');
        },
        options: {
          sessionKey: context.sessionKey,
          allowTools: true,
          source: context.toolContext.source || 'user',
          signal
        }
      });
    } finally {
      if (controller) {
        this.registry.end(context.sessionKey, controller);
      }
    }
  }

  private async finalize(params: FinalizeExecutionParams): Promise<void> {
    const {
      sessionKey,
      request,
      content,
      reasoning_content,
      agentMode,
      suppressOutbound = false,
      requestContentForMemory
    } = params;

    if (content) {
      await this.sessionManager.addMessage(sessionKey, 'assistant', content);
    }

    const llmResponse: LLMResponse = {
      content,
      reasoning_content,
      toolCalls: [],
      finishReason: agentMode ? 'tool_use' : 'stop'
    };

    const pluginManager = this.getPluginManager();
    if (pluginManager) {
      await pluginManager.runAgentAfterTaps({
        message: request,
        response: llmResponse
      });
    }

    if (!suppressOutbound) {
      await this.sendOutbound({
        channel: request.channel,
        chatId: request.chatId,
        content,
        reasoning_content,
        messageType: request.messageType
      });
    }

    if (this.memoryService) {
      await this.memoryService.maybeSummarizeSession(sessionKey);
      this.memoryService.enqueueLongTermMemoryMaintenance(
        sessionKey,
        {
          ...request,
          content: requestContentForMemory ?? request.content
        },
        content
      );
    }
  }

  private async prepareVisionTurn(
    context: ExecutionContext,
    policy: ExecutionPolicy,
    executionLog: ReturnType<typeof this.log.withFields>
  ): Promise<VisionPreparationResult> {
    const fallbackModel = policy.visionSettings?.fallbackModelName;
    const directVision = policy.visionSettings?.directVision === true;

    if (!policy.visionProvider || !fallbackModel) {
      executionLog.warn('检测到图片输入，但缺少视觉回退摘要模型配置', {
        directVision
      });
      return {
        ok: false,
        message: ExecutionRuntime.VISION_SUMMARY_REQUIRED_MESSAGE
      };
    }

    try {
      const response = await policy.visionProvider.chat(
        [
          {
            role: 'system',
            content: ExecutionRuntime.IMAGE_SUMMARY_SYSTEM_PROMPT
          },
          {
            role: 'user',
            content: buildVisionUserContent(
              context.request.content,
              context.request.media,
              context.request.files
            )
          }
        ],
        undefined,
        fallbackModel,
        {
          reasoning: policy.visionSettings?.reasoning
        }
      );
      const imageSummary = response.content?.trim();
      if (!imageSummary) {
        executionLog.warn('视觉回退摘要模型返回了空摘要', {
          directVision,
          fallbackModel
        });
        return {
          ok: false,
          message: ExecutionRuntime.VISION_SUMMARY_FAILED_MESSAGE
        };
      }

      const persistedUserContent = this.buildPersistedUserContent(context.request.content, imageSummary);
      executionLog.info('图片摘要已生成并写入会话上下文', {
        directVision,
        fallbackModel,
        currentTurnMode: directVision ? 'direct-vision' : 'summary-only'
      });

      return directVision
        ? {
            ok: true,
            persistedUserContent
          }
        : {
            ok: true,
            persistedUserContent,
            currentTurnContent: persistedUserContent
          };
    } catch (error) {
      executionLog.warn('视觉回退摘要模型执行失败', {
        directVision,
        fallbackModel,
        error: error instanceof Error ? error.message : String(error)
      });
      return {
        ok: false,
        message: ExecutionRuntime.VISION_SUMMARY_FAILED_MESSAGE
      };
    }
  }

  private buildPersistedUserContent(content: string, imageSummary: string): string {
    const trimmedContent = content.trim();
    const trimmedSummary = imageSummary.trim();
    if (!trimmedContent) {
      return `${ExecutionRuntime.IMAGE_SUMMARY_PREFIX}\n${trimmedSummary}`;
    }

    return `${trimmedContent}\n\n${ExecutionRuntime.IMAGE_SUMMARY_PREFIX}\n${trimmedSummary}`;
  }

  private replaceCurrentTurnContent(messages: LLMMessage[], content: VisionUserContent): void {
    const currentMessage = messages[messages.length - 1];
    if (currentMessage?.role !== 'user') {
      return;
    }

    currentMessage.content = content;
  }

  private hasVisionInput(inbound: InboundMessage): boolean {
    return (Array.isArray(inbound.media) && inbound.media.length > 0)
      || (Array.isArray(inbound.files) && inbound.files.some((file) => file.type === 'image'));
  }
}
