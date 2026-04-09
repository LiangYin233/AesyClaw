import type { SessionContext } from '../agent/core/session/session-context.js';
import type { SessionOptions } from '../agent/core/session/types.js';

export interface ISessionRegistry {
  getOrCreate(sessionId: string, options: SessionOptions): SessionContext;
  getSession(sessionId: string): SessionContext | undefined;
  deleteSession(sessionId: string): boolean;
  getSessionCount(): number;
  getSessionIdByChatId(channel: string, type: string, chatId: string): string | undefined;
  shutdown(): void;
}
