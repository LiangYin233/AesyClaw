import { logger } from '../platform/observability/logger.js';
import type { IChannelContext, MiddlewareFunc } from '../agent/core/types.js';
import { SessionId } from '../agent/core/session/session-id.js';
import { sessionRegistry } from '../agent/core/session/session-registry.js';
import type { SessionContext } from '../agent/core/session/session-context.js';

export interface SessionState {
  sessionContext: SessionContext;
  sessionId: string;
}

export class SessionMiddleware {
  name = 'SessionMiddleware';

  getMiddleware(): MiddlewareFunc {
    return async (ctx: IChannelContext, next: () => Promise<void>) => {
      try {
        const channel = ctx.inbound.channelId;
        const type = (ctx.inbound.metadata?.type as string) || 'default';
        const chatId = ctx.inbound.chatId;

        const existingSessionId = sessionRegistry.getSessionIdByChatId(channel, type, chatId);
        let sessionId: string;
        let components: { channel: string; type: string; chatId: string; session: string };

        if (existingSessionId) {
          sessionId = existingSessionId;
          components = SessionId.parse(sessionId);
          logger.debug({ sessionId, channel, type, chatId }, '复用已有会话');
        } else {
          sessionId = SessionId.fromUnifiedMessage(ctx.inbound);
          components = SessionId.parse(sessionId);
        }

        const sessionContext = sessionRegistry.getOrCreate(sessionId, {
          channel: components.channel,
          type: components.type,
          chatId: components.chatId,
          session: components.session,
        });

        const sessionState: SessionState = {
          sessionContext,
          sessionId,
        };

        if (!ctx.state) {
          ctx.state = sessionState as unknown as Record<string, unknown>;
        } else {
          Object.assign(ctx.state, sessionState);
        }

        logger.debug(
          {
            sessionId,
            channel: components.channel,
            type: components.type,
            chatId: components.chatId,
            totalSessions: sessionRegistry.getSessionCount(),
          },
          '📱 Session 中间件: 会话已注入'
        );

        await next();
      } catch (error) {
        logger.error(
          { error },
          '❌ Session 中间件: 会话创建失败'
        );
        throw error;
      }
    };
  }
}

export const sessionMiddleware = new SessionMiddleware();

export function getSessionFromContext(ctx: IChannelContext): SessionContext | null {
  const state = ctx.state as unknown as SessionState;
  return state?.sessionContext || null;
}

export function getSessionIdFromContext(ctx: IChannelContext): string | null {
  const state = ctx.state as unknown as SessionState;
  return state?.sessionId || null;
}
