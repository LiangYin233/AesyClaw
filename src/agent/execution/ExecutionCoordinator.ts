import type { InboundMessage, LLMMessage } from '../../types.js';
import type { ToolContext } from '../../tools/ToolRegistry.js';
import type { AgentExecutor } from './engine/AgentExecutor.js';
import type { BackgroundTaskManager } from './BackgroundTaskManager.js';
import type { ExecutionFinalizeService } from './ExecutionFinalizeService.js';
import { logger } from '../../logger/index.js';

export interface CoordinateExecutionRequest {
  sessionKey: string;
  agentName: string;
  request: InboundMessage;
  messages: LLMMessage[];
  toolContext: ToolContext;
  suppressOutbound?: boolean;
  sendOutbound: (message: {
    channel: string;
    chatId: string;
    content: string;
    reasoning_content?: string;
    messageType?: 'private' | 'group';
  }) => Promise<void>;
}

export interface CoordinateExecutionResult {
  content: string;
  needsBackground: boolean;
}

export class ExecutionCoordinator {
  private log = logger.child({ prefix: 'ExecutionCoordinator' });
  private static readonly IMAGE_SUMMARY_PREFIX = '【图片概括】';

  constructor(
    private executor: AgentExecutor,
    private backgroundTasks: BackgroundTaskManager,
    private completionService: ExecutionFinalizeService
  ) {}

  async execute(request: CoordinateExecutionRequest): Promise<CoordinateExecutionResult> {
    const {
      sessionKey,
      agentName,
      request: inbound,
      messages,
      toolContext,
      suppressOutbound = false,
      sendOutbound
    } = request;

    const useVisionProvider = this.executor.needsVisionProvider(inbound.media, inbound.files);

    let result;
    if (useVisionProvider) {
      const imageSummary = await this.executor.summarizeVisionInput(messages);
      if (imageSummary) {
        this.attachImageSummary(inbound, messages, imageSummary);
      }

      this.log.info('Using vision provider', {
        sessionKey,
        agent: agentName,
        channel: inbound.channel,
        chatId: inbound.chatId
      });
      result = await this.executor.executeWithVision(messages, toolContext, {
        allowTools: true,
        agentName,
        source: 'user',
        sessionKey
      });
    } else {
      result = await this.executor.executeWithBackground(messages, toolContext, {
        allowTools: true,
        agentName,
        source: 'user',
        sessionKey,
        onNeedsBackground: async (response, bgMessages, bgContext) => {
          const taskHandle = await this.backgroundTasks.startTask(
            this.executor,
            sessionKey,
            inbound.channel,
            inbound.chatId,
            inbound.messageType,
            bgMessages,
            bgContext,
            response as any,
            {
              onComplete: async (bgResult, finalMessages) => {
                await this.completionService.finalize({
                  sessionKey,
                  request: inbound,
                  content: bgResult.content,
                  reasoning_content: bgResult.reasoning_content,
                  agentMode: bgResult.agentMode,
                  sessionMessages: finalMessages,
                  suppressOutbound,
                  sendOutbound
                });
                this.log.info('Background task completed', {
                  sessionKey,
                  agent: agentName,
                  channel: inbound.channel,
                  chatId: inbound.chatId,
                  outboundSuppressed: suppressOutbound
                });
              },
              onError: async (error) => {
                this.log.error('Background task failed', {
                  sessionKey,
                  agent: agentName,
                  channel: inbound.channel,
                  chatId: inbound.chatId,
                  error
                });
                await this.completionService.handleError(error, sessionKey);
              }
            }
          );

          this.log.info('Background task scheduled', {
            sessionKey,
            taskId: taskHandle.id,
            agent: agentName,
            channel: inbound.channel,
            chatId: inbound.chatId
          });
        }
      });
    }

    const bgResult = result as any;
    if (bgResult.needsBackground) {
      return {
        content: result.content,
        needsBackground: true
      };
    }

    await this.completionService.finalize({
      sessionKey,
      request: inbound,
      content: result.content,
      reasoning_content: result.reasoning_content,
      agentMode: result.agentMode,
      sessionMessages: messages,
      suppressOutbound,
      sendOutbound
    });

    this.log.info('Execution finalized', {
      sessionKey,
      agent: agentName,
      channel: inbound.channel,
      chatId: inbound.chatId,
      toolCount: result.toolsUsed.length,
      needsBackground: false
    });

    return {
      content: result.content,
      needsBackground: false
    };
  }

  private attachImageSummary(inbound: InboundMessage, messages: LLMMessage[], summary: string): void {
    const summaryBlock = `${ExecutionCoordinator.IMAGE_SUMMARY_PREFIX}\n${summary}`;
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
