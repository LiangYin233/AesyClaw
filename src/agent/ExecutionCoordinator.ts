import type { InboundMessage, LLMMessage } from '../types.js';
import type { ToolContext } from '../tools/ToolRegistry.js';
import type { AgentExecutor } from './executor/AgentExecutor.js';
import type { BackgroundTaskManager } from './BackgroundTaskManager.js';
import type { ExecutionCompletionService } from './ExecutionCompletionService.js';
import { logger } from '../logger/index.js';

export interface CoordinateExecutionRequest {
  sessionKey: string;
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

  constructor(
    private executor: AgentExecutor,
    private backgroundTasks: BackgroundTaskManager,
    private completionService: ExecutionCompletionService
  ) {}

  async execute(request: CoordinateExecutionRequest): Promise<CoordinateExecutionResult> {
    const {
      sessionKey,
      request: inbound,
      messages,
      toolContext,
      suppressOutbound = false,
      sendOutbound
    } = request;

    const useVisionProvider = this.executor.needsVisionProvider(inbound.media, inbound.files);

    let result;
    if (useVisionProvider) {
      this.log.info(`Using vision provider for session ${sessionKey}`);
      result = await this.executor.executeWithVision(messages, toolContext, {
        allowTools: true,
        source: 'user',
        sessionKey
      });
    } else {
      result = await this.executor.executeWithBackground(messages, toolContext, {
        allowTools: true,
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
                this.log.info(`Background task completed for session ${sessionKey}`);
              },
              onError: async (error) => {
                this.log.error(`Background task error for session ${sessionKey}:`, error);
                await this.completionService.handleError(error, sessionKey);
              }
            }
          );

          this.log.info(`Delegated session ${sessionKey} to background task ${taskHandle.id}`);
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

    this.log.debug(`Completed session ${sessionKey}, tools: ${result.toolsUsed.join(', ') || '(none)'}`);

    return {
      content: result.content,
      needsBackground: false
    };
  }
}
