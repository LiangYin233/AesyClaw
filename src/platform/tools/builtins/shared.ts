import type { ToolContext } from '../ToolRegistry.js';

export interface BuiltInLogger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export function throwIfToolAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return;
  }

  const reason = signal.reason;
  if (reason instanceof Error) {
    throw reason;
  }

  const error = new Error(typeof reason === 'string' ? reason : 'Tool execution aborted');
  error.name = 'AbortError';
  throw error;
}

export function rethrowToolAbortError(error: unknown, signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw error;
  }

  if (error instanceof Error && error.name === 'AbortError') {
    throw error;
  }
}

export function requireSessionContext(context?: ToolContext): { channel: string; chatId: string } {
  if (!context?.channel || !context?.chatId) {
    throw new Error('错误：无法获取当前会话信息，此工具只能在用户会话中使用。');
  }

  return {
    channel: context.channel,
    chatId: context.chatId
  };
}

export function formatToolError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
