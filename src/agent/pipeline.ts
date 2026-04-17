import { randomUUID } from 'crypto';
import type { PluginHookRuntime } from '@/contracts/plugin-hook-runtime.js';
import type {
  ChannelContext,
  ChannelReceiveMessage,
  ChannelSendMessage,
  MiddlewareFunc,
} from './types.js';
import type { ChannelSendPayload } from '@/channels/channel-plugin.js';
import { logger } from '@/platform/observability/logger.js';
import { toErrorMessage } from '@/platform/utils/errors.js';

export class ChannelPipeline {
  private middlewares: MiddlewareFunc[] = [];
  private hookRuntime: PluginHookRuntime;

  constructor(hookRuntime: PluginHookRuntime) {
    this.hookRuntime = hookRuntime;
  }

  use(middleware: MiddlewareFunc): void {
    this.middlewares.push(middleware);
    logger.debug({ middlewareCount: this.middlewares.length }, 'Middleware registered');
  }

  async receive(message: ChannelReceiveMessage): Promise<ChannelContext> {
    return this.receiveWithSend(message, undefined);
  }

  async receiveWithSend(
    message: ChannelReceiveMessage,
    send?: (_payload: ChannelSendPayload) => Promise<void>
  ): Promise<ChannelContext> {
    const traceId = randomUUID();
    const startTime = Date.now();

    logger.info(
      { traceId, chatId: message.chatId, text: message.text },
      'Received inbound message, dispatching to middleware chain'
    );

    const hookResult = await this.hookRuntime.dispatchReceive({
      message: {
        channelId: message.channelId,
        chatId: message.chatId,
        text: message.text,
        timestamp: message.timestamp,
        metadata: message.metadata,
      },
    });

    if (hookResult.blocked) {
      logger.info(
        { traceId, chatId: message.chatId, reason: hookResult.reason },
        'Message blocked by plugin, skipping further processing'
      );
      return {
        traceId,
        received: message,
        sendMessage: { text: '', mediaFiles: [] },
        createdAt: Date.now(),
        blocked: true,
      } as ChannelContext & { blocked?: boolean };
    }

    const ctx: ChannelContext = {
      traceId,
      received: hookResult.message,
      sendMessage: {
        text: '',
        mediaFiles: [],
      } as ChannelSendMessage,
      createdAt: Date.now(),
      send,
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

      const processedSendMessage = await this.hookRuntime.dispatchSend({
        message: {
          chatId: ctx.received.chatId,
          text: ctx.sendMessage?.text,
          mediaFiles: ctx.sendMessage?.mediaFiles,
          error: ctx.sendMessage?.error,
        },
      });

      if (processedSendMessage.blocked) {
        logger.info(
          { traceId, chatId: ctx.received.chatId, reason: processedSendMessage.reason },
          'Send message blocked by plugin'
        );
        ctx.sendMessage.text = '';
        ctx.sendMessage.mediaFiles = [];
        return ctx;
      }

      ctx.sendMessage.text = processedSendMessage.message.text;
      ctx.sendMessage.mediaFiles = processedSendMessage.message.mediaFiles;
      ctx.sendMessage.error = processedSendMessage.message.error;

      if (ctx.send && ctx.sendMessage?.text) {
        await ctx.send({
          text: ctx.sendMessage.text,
          mediaFiles: ctx.sendMessage.mediaFiles,
        });
        logger.debug({ traceId, chatId: ctx.received.chatId }, 'Response sent via channel send');
      }

      const duration = Date.now() - startTime;
      const sendText = ctx.sendMessage?.text ?? '';
      const sendLength = sendText.length;
      logger.info(
        { traceId, chatId: ctx.received.chatId, duration, sendLength },
        'Message processing completed, returning response'
      );
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = toErrorMessage(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      logger.error(
        { traceId, chatId: ctx.received.chatId, duration, error: errorMessage, stack: errorStack },
        'Error during message processing'
      );
      if (!ctx.sendMessage) {
        ctx.sendMessage = { text: '', mediaFiles: [] };
      }
      ctx.sendMessage.text = 'Internal system error, please try again later';
      ctx.sendMessage.error = errorMessage;

      if (ctx.send && ctx.sendMessage?.text) {
        await ctx.send({
          text: ctx.sendMessage.text,
          mediaFiles: ctx.sendMessage.mediaFiles ?? [],
        });
      }
    }

    return ctx;
  }
}
