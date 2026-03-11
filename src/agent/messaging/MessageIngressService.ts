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
    this.log.debug(`processMessage: content="${msg.content}", media=${JSON.stringify(msg.media)}`);

    const preprocessResult = await this.preprocessingService.process(msg, {
      suppressOutbound: options.suppressOutbound,
      sendOutbound: options.sendOutbound
    });

    if (preprocessResult.type === 'handled') {
      return undefined;
    }

    if (preprocessResult.type === 'reply') {
      return preprocessResult.content;
    }

    const context = await this.contextResolver.resolve(preprocessResult.message, {
      toolContext: options.toolContext,
      suppressOutbound: options.suppressOutbound,
      memoryWindow: options.memoryWindow
    });

    return this.executionService.execute(context);
  }
}
