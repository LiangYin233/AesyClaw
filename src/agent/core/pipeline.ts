import { randomUUID } from 'crypto';
import { IUnifiedMessage, IChannelContext, IOutboundMessage, MiddlewareFunc } from './types';
import { logger } from '../../platform/observability/logger';

export class ChannelPipeline {
  private middlewares: MiddlewareFunc[] = [];

  use(middleware: MiddlewareFunc): void {
    this.middlewares.push(middleware);
    logger.debug({ middlewareCount: this.middlewares.length }, '中间件已注册');
  }

  async handleInbound(message: IUnifiedMessage): Promise<IChannelContext> {
    const traceId = randomUUID();
    const startTime = Date.now();

    logger.info(
      { traceId, chatId: message.chatId, senderId: message.senderId, text: message.text },
      '📥 收到入站消息，准备派发到中间件链'
    );

    const ctx: IChannelContext = {
      traceId,
      inbound: message,
      outbound: {
        text: '',
        mediaFiles: [],
      } as IOutboundMessage,
      createdAt: Date.now(),
    };

    if (this.middlewares.length === 0) {
      logger.warn({ traceId }, '⚠️ 警告：没有任何中间件被注册，直接返回空响应');
      return ctx;
    }

    let index = 0;

    const next: () => Promise<void> = async () => {
      if (index < this.middlewares.length) {
        const currentMiddleware = this.middlewares[index++];
        logger.debug(
          { traceId, middlewareIndex: index - 1, remaining: this.middlewares.length - index },
          `🔗 执行中间件 ${index}/${this.middlewares.length}`
        );
        await currentMiddleware(ctx, next);
      } else {
        logger.debug({ traceId }, '✅ 中间件链执行完毕');
      }
    };

    try {
      await next();
      const duration = Date.now() - startTime;
      logger.info(
        { traceId, chatId: message.chatId, duration, outboundLength: ctx.outbound.text.length },
        '📤 消息处理完成，准备返回响应'
      );
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(
        { traceId, chatId: message.chatId, duration, error },
        '❌ 消息处理过程中发生错误'
      );
      ctx.outbound.text = '系统内部错误，请稍后重试';
      ctx.outbound.error = error instanceof Error ? error.message : String(error);
    }

    return ctx;
  }
}
