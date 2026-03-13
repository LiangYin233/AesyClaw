import type { OutboundMessage, InboundMessage, LLMMessage } from '../../types.js';
import type { PluginManager } from '../../plugins/index.js';
import type { ExecutionContext } from './ExecutionTypes.js';
import type { ExecutionEngine } from './ExecutionEngine.js';
import type { ExecutionFinalizer } from './ExecutionFinalizer.js';
import type { ExecutionControl } from './ExecutionControl.js';
import { logger } from '../../observability/index.js';

export class ExecutionRuntime {
  private log = logger.child('ExecutionRuntime');
  private readonly subAgentExcludedTools = ['send_msg_to_user', 'call_agent'];
  private static readonly IMAGE_SUMMARY_PREFIX = '【图片概括】';

  constructor(
    private engine: ExecutionEngine,
    private control: ExecutionControl,
    private finalizer: ExecutionFinalizer,
    private getPluginManager: () => PluginManager | undefined,
    private sendOutbound: (message: OutboundMessage) => Promise<void>
  ) {}

  async execute(context: ExecutionContext): Promise<string | undefined> {
    const startedAt = Date.now();
    try {
      const { policy, executor, messages } = this.engine.prepare(context);
      const pluginManager = this.getPluginManager();

      if (pluginManager) {
        await pluginManager.runAgentBeforeTaps({
          message: context.request,
          messages
        });
      }

      const useVisionProvider = executor.needsVisionProvider(context.request.media, context.request.files);
      if (useVisionProvider) {
        const imageSummary = await executor.summarizeVisionInput(messages, context.toolContext.signal);
        if (imageSummary) {
          this.attachImageSummary(context.request, messages, imageSummary);
        }

        this.log.info('Using vision provider', {
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

        await this.finalizer.finalize({
          sessionKey: context.sessionKey,
          request: context.request,
          content: result.content,
          reasoning_content: result.reasoning_content,
          agentMode: result.agentMode,
          sessionMessages: messages,
          suppressOutbound: context.suppressOutbound,
          sendOutbound: this.sendOutbound
        });

        this.log.info('Request executed in foreground', {
          sessionKey: context.sessionKey,
          channel: context.channel,
          chatId: context.chatId,
          agent: policy.roleName,
          durationMs: Date.now() - startedAt
        });
        return result.content;
      }

      const result = await executor.executeWithBackground(messages, context.toolContext, {
        allowTools: true,
        agentName: policy.roleName,
        source: context.toolContext.source || 'user',
        sessionKey: context.sessionKey,
        onNeedsBackground: async (response, bgMessages, bgContext) => {
          const taskHandle = await this.control.backgroundTasks.startTask(
            executor,
            context.sessionKey,
            context.request.channel,
            context.request.chatId,
            context.request.messageType,
            bgMessages,
            bgContext,
            response as any,
            {
              onComplete: async (bgResult, finalMessages) => {
                await this.finalizer.finalize({
                  sessionKey: context.sessionKey,
                  request: context.request,
                  content: bgResult.content,
                  reasoning_content: bgResult.reasoning_content,
                  agentMode: bgResult.agentMode,
                  sessionMessages: finalMessages,
                  suppressOutbound: context.suppressOutbound,
                  sendOutbound: this.sendOutbound
                });

                this.log.info('Background task completion delivered', {
                  sessionKey: context.sessionKey,
                  agent: policy.roleName,
                  channel: context.request.channel,
                  chatId: context.request.chatId
                });
              },
              onError: async (error) => {
                await this.finalizer.handleError(error, context.sessionKey);
              }
            }
          );

          this.log.info('Background task scheduled', {
            sessionKey: context.sessionKey,
            taskId: taskHandle.id,
            agent: policy.roleName,
            channel: context.request.channel,
            chatId: context.request.chatId
          });
        }
      });

      const backgroundResult = result as any;
      if (backgroundResult.needsBackground) {
        this.log.info('Request delegated to background', {
          sessionKey: context.sessionKey,
          channel: context.channel,
          chatId: context.chatId,
          agent: policy.roleName,
          durationMs: Date.now() - startedAt
        });
        return result.content;
      }

      await this.finalizer.finalize({
        sessionKey: context.sessionKey,
        request: context.request,
        content: result.content,
        reasoning_content: result.reasoning_content,
        agentMode: result.agentMode,
        sessionMessages: messages,
        suppressOutbound: context.suppressOutbound,
        sendOutbound: this.sendOutbound
      });

      this.log.info('Request executed in foreground', {
        sessionKey: context.sessionKey,
        channel: context.channel,
        chatId: context.chatId,
        agent: policy.roleName,
        durationMs: Date.now() - startedAt
      });

      return result.content;
    } catch (error) {
      this.log.error('Request execution failed', {
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
