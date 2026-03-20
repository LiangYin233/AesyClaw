import type { OutboundMessage, InboundMessage, LLMMessage, LLMResponse } from '../../types.js';
import type { PluginManager } from '../../plugins/index.js';
import type { SessionManager } from '../../session/SessionManager.js';
import type { SessionMemoryService } from '../memory/SessionMemoryService.js';
import type { SessionRoutingService } from '../session/SessionRoutingService.js';
import type { ExecutionContext } from './ExecutionTypes.js';
import type { ExecutionEngine } from './ExecutionEngine.js';
import type { ExecutionStatus } from '../types.js';
import { logger } from '../../observability/index.js';
import { BackgroundTaskManager } from './BackgroundTaskManager.js';
import { ExecutionRegistry } from './ExecutionRegistry.js';

interface FinalizeExecutionParams {
  sessionKey: string;
  request: InboundMessage;
  content: string;
  reasoning_content?: string;
  agentMode: boolean;
  suppressOutbound?: boolean;
}

export class ExecutionRuntime {
  private log = logger.child('ExecutionRuntime');
  private readonly subAgentExcludedTools = ['send_msg_to_user', 'call_agent'];
  private static readonly IMAGE_SUMMARY_PREFIX = '【图片概括】';
  private static readonly VISION_DISABLED_MESSAGE = '当前 Agent 未启用视觉识别，暂时无法读取图片内容。请先在 Agent 配置中开启 Vision 并配置视觉模型后重试。';
  private readonly registry: ExecutionRegistry;
  private readonly backgroundTasks: BackgroundTaskManager;

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
    const startedAt = Date.now();
    let requestPersisted = false;
    const ensureRequestPersisted = async (): Promise<void> => {
      if (requestPersisted) {
        return;
      }

      await this.sessionManager.addMessage(context.sessionKey, 'user', context.request.content);
      requestPersisted = true;
    };

    try {
      const { policy, executor, messages } = this.engine.prepare(context);
      const pluginManager = this.getPluginManager();

      if (pluginManager) {
        await pluginManager.runAgentBeforeTaps({
          message: context.request,
          messages
        });
      }

      if (this.hasVisionInput(context.request) && !executor.needsVisionProvider(context.request.media, context.request.files)) {
        this.log.warn('检测到图片输入，但当前 Agent 未启用视觉识别', {
          sessionKey: context.sessionKey,
          agent: policy.roleName,
          channel: context.channel,
          chatId: context.chatId
        });

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
        const imageSummary = await executor.summarizeVisionInput(messages, context.toolContext.signal);
        if (imageSummary) {
          this.attachImageSummary(context.request, messages, imageSummary);
        }

        await ensureRequestPersisted();

        this.log.info('正在使用视觉模型处理', {
          sessionKey: context.sessionKey,
          agent: policy.roleName,
          channel: context.channel,
          chatId: context.chatId
        });

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

        this.log.info('请求已在前台完成', {
          sessionKey: context.sessionKey,
          channel: context.channel,
          chatId: context.chatId,
          agent: policy.roleName,
          durationMs: Date.now() - startedAt
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
          const taskHandle = await this.backgroundTasks.startTask(
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

                this.log.info('后台任务结果已发送', {
                  sessionKey: context.sessionKey,
                  agent: policy.roleName,
                  channel: context.request.channel,
                  chatId: context.request.chatId
                });
              },
              onError: async (error) => {
                await this.handleError(error, context.sessionKey);
              }
            }
          );

          this.log.info('后台任务已创建', {
            sessionKey: context.sessionKey,
            taskId: taskHandle.id,
            agent: policy.roleName,
            channel: context.request.channel,
            chatId: context.request.chatId
          });
        }
      });

      const backgroundResult = result as { needsBackground?: boolean; content: string };
      if (backgroundResult.needsBackground) {
        this.log.info('请求已转入后台处理', {
          sessionKey: context.sessionKey,
          channel: context.channel,
          chatId: context.chatId,
          agent: policy.roleName,
          durationMs: Date.now() - startedAt
        });
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

      this.log.info('请求已在前台完成', {
        sessionKey: context.sessionKey,
        channel: context.channel,
        chatId: context.chatId,
        agent: policy.roleName,
        durationMs: Date.now() - startedAt
      });

      return result.content;
    } catch (error) {
      this.log.error('请求执行失败', {
        sessionKey: context.sessionKey,
        channel: context.channel,
        chatId: context.chatId,
        durationMs: Date.now() - startedAt,
        error
      });
      throw error;
    }
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

    this.log.info('执行结果已完成收尾', {
      sessionKey,
      channel: request.channel,
      chatId: request.chatId,
      messageType: request.messageType,
      outboundSuppressed: suppressOutbound,
      responseLength: content.length
    });
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
