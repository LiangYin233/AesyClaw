import { randomUUID } from 'crypto';
import type { IPluginHookRuntime } from '@/contracts/plugin-hook-runtime.js';
import { IUnifiedMessage, IChannelContext, IOutboundMessage, MiddlewareFunc } from './types.js';
import type { IOutboundPayload } from '@/channels/channel-plugin.js';
import { logger } from '@/platform/observability/logger.js';

export class ChannelPipeline {
  private middlewares: MiddlewareFunc[] = [];
  private hookRuntime: IPluginHookRuntime;

  constructor(hookRuntime: IPluginHookRuntime) {
    this.hookRuntime = hookRuntime;
  }

  use(middleware: MiddlewareFunc): void {
    this.middlewares.push(middleware);
    logger.debug({ middlewareCount: this.middlewares.length }, 'Middleware registered');
  }

  async handleInbound(message: IUnifiedMessage): Promise<IChannelContext> {
    return this.handleInboundWithSend(message, undefined);
  }

  async handleInboundWithSend(
    message: IUnifiedMessage,
    sendFn?: (_payload: IOutboundPayload) => Promise<void>
  ): Promise<IChannelContext> {
    const traceId = randomUUID();
    const startTime = Date.now();

    logger.info(
      { traceId, chatId: message.chatId, text: message.text },
      'Received inbound message, dispatching to middleware chain'
    );

    const hookResult = await this.hookRuntime.dispatchMessageReceive({
      message: {
        channelId: message.channelId,
        chatId: message.chatId,
        text: message.text,
        timestamp: message.timestamp,
        metadata: message.metadata,
      },
    });

    if (!hookResult) {
      logger.info(
        { traceId, chatId: message.chatId },
        'Message blocked by plugin, skipping further processing'
      );
      return {
        traceId,
        inbound: message,
        outbound: { text: '', mediaFiles: [] },
        createdAt: Date.now(),
        blocked: true,
      } as IChannelContext & { blocked?: boolean };
    }

    const ctx: IChannelContext = {
      traceId,
      inbound: hookResult as typeof message,
      outbound: {
        text: '',
        mediaFiles: [],
      } as IOutboundMessage,
      createdAt: Date.now(),
      sendFn,
    };

    if (this.middlewares.length === 0) {
      logger.warn({ traceId }, 'Warning: No middleware registered, returning empty response');
      return ctx;
    }

    let index = 0;

    const next: () => Promise<void> = async () => {
      if (index < this.middlewares.length) {
        const currentMiddleware = this.middlewares[index++];
        logger.debug(
          { traceId, middlewareIndex: index - 1, remaining: this.middlewares.length - index },
          `Executing middleware ${index}/${this.middlewares.length}`
        );
        await currentMiddleware(ctx, next);
      } else {
        logger.debug({ traceId }, 'Middleware chain completed');
      }
    };

    try {
      await next();

      const processedOutbound = await this.hookRuntime.dispatchMessageSend({
        message: {
          chatId: ctx.inbound.chatId,
          text: ctx.outbound?.text,
          mediaFiles: ctx.outbound?.mediaFiles,
          error: ctx.outbound?.error,
        },
      });

      if (processedOutbound) {
        ctx.outbound.text = processedOutbound.text;
        ctx.outbound.mediaFiles = processedOutbound.mediaFiles;
        ctx.outbound.error = processedOutbound.error;
      }

      if (sendFn && ctx.outbound?.text) {
        await sendFn({
          text: ctx.outbound.text,
          mediaFiles: ctx.outbound.mediaFiles,
        });
        logger.debug({ traceId, chatId: ctx.inbound.chatId }, 'Response sent via sendFn');
      }

      const duration = Date.now() - startTime;
      const outboundText = ctx.outbound?.text ?? '';
      const outboundLength = outboundText.length;
      logger.info(
        { traceId, chatId: ctx.inbound.chatId, duration, outboundLength },
        'Message processing completed, returning response'
      );
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      logger.error(
        { traceId, chatId: ctx.inbound.chatId, duration, error: errorMessage, stack: errorStack },
        'Error during message processing'
      );
      if (!ctx.outbound) {
        ctx.outbound = { text: '', mediaFiles: [] };
      }
      ctx.outbound.text = 'Internal system error, please try again later';
      ctx.outbound.error = errorMessage;

      if (sendFn && ctx.outbound?.text) {
        await sendFn({
          text: ctx.outbound.text,
          mediaFiles: ctx.outbound.mediaFiles ?? [],
        });
      }
    }

    return ctx;
  }
}
