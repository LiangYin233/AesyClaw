import type { InboundMessage, OutboundMessage } from '../../types.js';
import type { ToolContext } from '../../tools/ToolRegistry.js';
import { logger } from '../../logger/index.js';
import { MessagePreprocessingService } from './MessagePreprocessingService.js';
import type { ExecutionContextResolver } from '../execution/ExecutionContextResolver.js';
import type { MessageExecutionService } from '../execution/MessageExecutionService.js';

export class MessageIngressService {
  private log = logger.child({ prefix: 'MessageIngressService' });

  constructor(
    private preprocessingService: MessagePreprocessingService,
    private contextResolver: ExecutionContextResolver,
    private executionService: MessageExecutionService
  ) {}

  setPreprocessingService(service: MessagePreprocessingService): void {
    this.preprocessingService = service;
  }

  async processMessage(
    msg: InboundMessage,
    options: {
      suppressOutbound?: boolean;
      toolContext: ToolContext;
      memoryWindow: number;
      sendOutbound: (message: OutboundMessage) => Promise<void>;
    }
  ): Promise<string | undefined> {
    const startedAt = Date.now();
    this.log.info('Inbound message received', {
      sessionKey: msg.sessionKey,
      channel: msg.channel,
      chatId: msg.chatId,
      messageType: msg.messageType,
      source: msg.metadata?.directResponse ? 'direct' : msg.metadata?.source || 'user'
    });

    const preprocessResult = await this.preprocessingService.process(msg, {
      suppressOutbound: options.suppressOutbound,
      sendOutbound: options.sendOutbound
    });

    if (preprocessResult.type === 'handled') {
      this.log.info('Inbound message handled by preprocessing', {
        sessionKey: msg.sessionKey,
        channel: msg.channel,
        durationMs: Date.now() - startedAt
      });
      return undefined;
    }

    if (preprocessResult.type === 'reply') {
      this.log.info('Inbound message replied by preprocessing', {
        sessionKey: msg.sessionKey,
        channel: msg.channel,
        durationMs: Date.now() - startedAt
      });
      return preprocessResult.content;
    }

    const context = await this.contextResolver.resolve(preprocessResult.message, {
      toolContext: options.toolContext,
      suppressOutbound: options.suppressOutbound,
      memoryWindow: options.memoryWindow
    });

    const result = await this.executionService.execute(context);
    this.log.info('Inbound message execution finished', {
      sessionKey: context.sessionKey,
      channel: context.channel,
      durationMs: Date.now() - startedAt,
      suppressOutbound: context.suppressOutbound
    });
    return result;
  }
}
