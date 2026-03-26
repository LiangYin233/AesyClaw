import type { OutboundMessage, InboundMessage, LLMMessage, LLMResponse } from '../../../types.js';
import type { PluginManager } from '../../../features/plugins/index.js';
import type { SessionManager } from '../../../features/sessions/application/SessionManager.js';
import type { SessionMemoryService } from '../memory/SessionMemoryService.js';
import type { SessionRoutingService } from '../session/SessionRoutingService.js';
import type { ExecutionContext } from './ExecutionTypes.js';
import type { ExecutionEngine } from './ExecutionEngine.js';
import type { ExecutionStatus } from '../../domain/execution.js';
import { BackgroundTaskManager } from './BackgroundTaskManager.js';
import { ExecutionRegistry } from './ExecutionRegistry.js';
import { logger } from '../../../platform/observability/index.js';

interface FinalizeExecutionParams {
  sessionKey: string;
  request: InboundMessage;
  content: string;
  reasoning_content?: string;
  agentMode: boolean;
  suppressOutbound?: boolean;
}

export class ExecutionRuntime {
  private readonly subAgentExcludedTools = ['send_msg_to_user', 'call_agent', 'call_temp_agent'];
  private static readonly IMAGE_SUMMARY_PREFIX = '【图片概括】';
  private static readonly VISION_DISABLED_MESSAGE = '当前 Agent 未启用视觉识别，暂时无法读取图片内容。请先在 Agent 配置中开启 Vision 并配置视觉模型后重试。';
  private readonly registry: ExecutionRegistry;
  private readonly backgroundTasks: BackgroundTaskManager;
  private readonly log = logger.child('ExecutionRuntime');

  constructor(args: {
    engine: ExecutionEngine;
    sessionRouting: SessionRoutingService;
    sessionManager: SessionManager;
    memoryService?: SessionMemoryService;
    getPluginManager: () => PluginManager | undefined;
    sendOutbound: (message: OutboundMessage) => Promise<void>;
    executionRegistry?: ExecutionRegistry;
    backgroundTaskManager?: BackgroundTaskManager;
  }) {
    this.engine = args.engine;
    this.sessionRouting = args.sessionRouting;
    this.sessionManager = args.sessionManager;
    this.memoryService = args.memoryService;
    this.getPluginManager = args.getPluginManager;
    this.sendOutbound = args.sendOutbound;
    this.registry = args.executionRegistry ?? new ExecutionRegistry();
    this.backgroundTasks = args.backgroundTaskManager ?? new BackgroundTaskManager(args.sendOutbound);
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
    const ensureRequestPersisted = async (): Promise<void> => {
      if (requestPersisted) {
        return;
      }

      await this.sessionManager.addMessage(context.sessionKey, 'user', context.request.content);
      requestPersisted = true;
    };

    const { policy, executor, messages } = this.engine.prepare(context);
    const executionLog = this.log.withFields({
      ssn: context.sessionKey,
      ch: context.request.channel,
      chId: context.request.chatId,
      agent: policy.roleName
    });
    executionLog.debug('执行开始', {
      source: context.toolContext.source || 'user'
    });
    const pluginManager = this.getPluginManager();

    if (pluginManager) {
      await pluginManager.runAgentBeforeTaps({
        message: context.request,
        messages
      });
    }

    if (this.hasVisionInput(context.request) && !executor.canHandleVision(context.request.media, context.request.files)) {
      executionLog.warn('检测到视觉输入，但当前未配置可用视觉模型，已跳过视觉执行');

      await ensureRequestPersisted();
      await this.finalize({
        sessionKey: context.sessionKey,
        request: context.request,
        content: ExecutionRuntime.VISION_DISABLED_MESSAGE,
        reasoning_content: undefined,
        agentMode: false,
        suppressOutbound: context.suppressOutbound
      });

      return ExecutionRuntime.VISION_DISABLED_MESSAGE;
    }

    const useVisionProvider = executor.needsVisionProvider(context.request.media, context.request.files);
    if (useVisionProvider) {
      executionLog.info('视觉执行开始');
      const imageSummary = await executor.summarizeVisionInput(messages, context.toolContext.signal);
      if (imageSummary) {
        this.attachImageSummary(context.request, messages, imageSummary);
      }

      await ensureRequestPersisted();

      const result = await executor.executeWithVision(messages, context.toolContext, {
        allowTools: true,
        agentName: policy.roleName,
        source: context.toolContext.source || 'user',
        sessionKey: context.sessionKey
      });

      await this.finalize({
        sessionKey: context.sessionKey,
        request: context.request,
        content: result.content,
        reasoning_content: result.reasoning_content,
        agentMode: result.agentMode,
        suppressOutbound: context.suppressOutbound
      });
      executionLog.debug('视觉执行完成', {
        agentMode: result.agentMode
      });
      return result.content;
    }

    await ensureRequestPersisted();
    const result = await executor.executeWithBackground(messages, context.toolContext, {
      allowTools: true,
      agentName: policy.roleName,
      source: context.toolContext.source || 'user',
      sessionKey: context.sessionKey,
      onNeedsBackground: async (response, bgMessages, bgContext) => {
        executionLog.info('执行已切换到后台任务');
        await this.backgroundTasks.startTask(
          executor,
          context.sessionKey,
          context.request.channel,
          context.request.chatId,
          context.request.messageType,
          bgMessages,
          bgContext,
          response as LLMResponse,
          {
            onComplete: async (bgResult) => {
              await this.finalize({
                sessionKey: context.sessionKey,
                request: context.request,
                content: bgResult.content,
                reasoning_content: bgResult.reasoning_content,
                agentMode: bgResult.agentMode,
                suppressOutbound: context.suppressOutbound
              });
            },
            onError: async (error) => {
              await this.handleError(error, context.sessionKey);
            }
          }
        );
      }
    });

    const backgroundResult = result as { needsBackground?: boolean; content: string };
    if (backgroundResult.needsBackground) {
      return result.content;
    }

    await this.finalize({
      sessionKey: context.sessionKey,
      request: context.request,
      content: result.content,
      reasoning_content: result.reasoning_content,
      agentMode: result.agentMode,
      suppressOutbound: context.suppressOutbound
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
    return this.engine.runSubAgentTask(agentName, task, {
      ...toolContext,
      signal: extra?.signal ?? toolContext.signal
    }, {
      signal: extra?.signal ?? toolContext.signal,
      excludeTools: this.subAgentExcludedTools
    });
  }

  async runTemporarySubAgentTask(
    baseAgentName: string | undefined,
    task: string,
    systemPrompt: string,
    toolContext: ExecutionContext['toolContext'],
    extra?: { signal?: AbortSignal }
  ): Promise<string> {
    return this.engine.runTemporarySubAgentTask(baseAgentName, task, systemPrompt, {
      ...toolContext,
      signal: extra?.signal ?? toolContext.signal
    }, {
      signal: extra?.signal ?? toolContext.signal,
      excludeTools: this.subAgentExcludedTools
    });
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
    return this.registry.abort(sessionKey) || this.backgroundTasks.abortTask(sessionKey);
  }

  abortByChat(channel: string, chatId: string): boolean {
    const sessionKey = this.sessionRouting.resolveByChannel(channel, chatId);
    const abortedForeground = sessionKey ? this.registry.abort(sessionKey) : false;
    const abortedBackground = sessionKey
      ? this.backgroundTasks.abortTask(sessionKey)
      : this.backgroundTasks.abortTaskByChannel(channel, chatId);

    return abortedForeground || abortedBackground;
  }

  getStatus(sessionKey: string): ExecutionStatus {
    const foreground = this.registry.getHandle(sessionKey);
    const background = this.backgroundTasks.getTasksBySessionHandle(sessionKey);

    return {
      sessionKey,
      foreground,
      background,
      active: !!foreground || background.length > 0
    };
  }

  stop(): void {
    for (const handle of this.registry.listHandles()) {
      this.registry.abort(handle.sessionKey);
    }
    this.backgroundTasks.stop();
  }

  private async finalize(params: FinalizeExecutionParams): Promise<void> {
    const {
      sessionKey,
      request,
      content,
      reasoning_content,
      agentMode,
      suppressOutbound = false
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
      this.memoryService.enqueueLongTermMemoryMaintenance(sessionKey, request, content);
    }
  }

  private async handleError(error: unknown, sessionKey: string): Promise<void> {
    const pluginManager = this.getPluginManager();
    if (pluginManager) {
      await pluginManager.runErrorTaps(error, { type: 'agent', data: { sessionKey } });
    }
  }

  private hasVisionInput(inbound: InboundMessage): boolean {
    return (Array.isArray(inbound.media) && inbound.media.length > 0)
      || (Array.isArray(inbound.files) && inbound.files.some((file) => file.type === 'image'));
  }

  private attachImageSummary(inbound: InboundMessage, messages: LLMMessage[], summary: string): void {
    const summaryBlock = `${ExecutionRuntime.IMAGE_SUMMARY_PREFIX}\n${summary}`;
    const currentContent = inbound.content?.trim() || '';
    inbound.content = currentContent ? `${currentContent}\n\n${summaryBlock}` : summaryBlock;
    inbound.metadata = {
      ...(inbound.metadata || {}),
      imageSummary: summary
    };

    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== 'user') {
      return;
    }

    if (Array.isArray(lastMessage.content)) {
      const content = [...lastMessage.content];
      const insertIndex = Math.max(1, content.findIndex((item: any) => item.type === 'image_url'));
      const textSegment: { type: 'text'; text: string } = { type: 'text', text: `\n\n${summaryBlock}` };

      if (insertIndex <= 0) {
        content.push(textSegment);
      } else {
        content.splice(insertIndex, 0, textSegment);
      }

      lastMessage.content = content;
      return;
    }

    const text = typeof lastMessage.content === 'string' ? lastMessage.content.trim() : '';
    lastMessage.content = text ? `${text}\n\n${summaryBlock}` : summaryBlock;
  }
}
