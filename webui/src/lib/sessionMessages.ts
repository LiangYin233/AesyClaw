import type { SessionMessage } from './types';

export function buildSessionMessageKey(sessionKey: string, message: SessionMessage, index: number): string {
  const timestamp = message.timestamp || 'no-time';
  const role = message.role || 'unknown';
  const preview = (message.content || '').slice(0, 32);
  return `${sessionKey}:${timestamp}:${role}:${preview}:${index}`;
}
