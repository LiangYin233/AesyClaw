/**
 * 错误处理辅助工具
 */

import { AesyClawError, ErrorCode } from './base';
import { createScopedLogger } from '@aesyclaw/core/logger';
import { ErrorTracker } from './tracker';

const logger = createScopedLogger('error-utils');

/**
 * 安全执行函数，捕获错误并返回结果或错误
 *
 * @param fn - 要执行的函数
 * @returns 成功时返回 { success: true, data: T }，失败时返回 { success: false, error: AesyClawError }
 */
export async function safeExecute<T>(
  fn: () => Promise<T>,
): Promise<{ success: true; data: T } | { success: false; error: AesyClawError }> {
  try {
    const data = await fn();
    return { success: true, data };
  } catch (error) {
    const aesyClawError = AesyClawError.from(error);
    return { success: false, error: aesyClawError };
  }
}

/**
 * 安全执行同步函数
 */
export function safeExecuteSync<T>(
  fn: () => T,
): { success: true; data: T } | { success: false; error: AesyClawError } {
  try {
    const data = fn();
    return { success: true, data };
  } catch (error) {
    const aesyClawError = AesyClawError.from(error);
    return { success: false, error: aesyClawError };
  }
}

/**
 * 重试执行函数，失败时自动重试
 *
 * @param fn - 要执行的函数
 * @param options - 重试选项
 * @returns 执行结果
 */
export async function retryExecute<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    delayMs?: number;
    onRetry?: (error: AesyClawError, attempt: number) => void;
  } = {},
): Promise<T> {
  const { maxRetries = 3, delayMs = 1000, onRetry } = options;

  let lastError: AesyClawError | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = AesyClawError.from(error);

      if (attempt < maxRetries) {
        if (onRetry) {
          onRetry(lastError, attempt);
        }
        logger.debug(`重试执行 (${attempt}/${maxRetries})`, {
          error: lastError.message,
          delayMs,
        });
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError;
}

/**
 * 带超时的执行函数
 *
 * @param fn - 要执行的函数
 * @param timeoutMs - 超时时间（毫秒）
 * @param errorCode - 超时错误码
 * @returns 执行结果
 */
export async function executeWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  errorCode = ErrorCode.TOOL_TIMEOUT,
): Promise<T> {
  return await Promise.race([
    fn(),
    new Promise<T>((_, reject) => {
      setTimeout(() => {
        reject(
          new AesyClawError(errorCode, `操作超时 (${timeoutMs}ms)`, { timeoutMs }),
        );
      }, timeoutMs);
    }),
  ]);
}

/**
 * 记录并重新抛出错误
 *
 * @param error - 错误实例
 * @param context - 上下文信息
 * @param track - 是否追踪错误
 */
export function logAndThrow(
  error: unknown,
  context?: Record<string, unknown>,
  track = true,
): never {
  const aesyClawError = AesyClawError.from(error);

  logger.error('错误发生', {
    code: aesyClawError.code,
    message: aesyClawError.message,
    details: aesyClawError.details,
    context,
  });

  if (track) {
    ErrorTracker.getInstance().track(aesyClawError, context);
  }

  throw aesyClawError;
}

/**
 * 判断错误是否为特定错误码
 */
export function isErrorCode(error: unknown, code: ErrorCode): boolean {
  return AesyClawError.isAesyClawError(error) && error.code === code;
}

/**
 * 判断错误是否为特定错误类型
 */
export function isErrorType<T extends AesyClawError>(
  error: unknown,
  errorClass: new (...args: unknown[]) => T,
): error is T {
  return error instanceof errorClass;
}

/**
 * 从错误中提取用户友好的消息
 */
export function getUserFriendlyMessage(error: unknown): string {
  if (AesyClawError.isAesyClawError(error)) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

/**
 * 将错误转换为工具执行结果格式
 */
export function errorToToolResult(error: unknown): {
  content: string;
  isError: true;
  details?: unknown;
} {
  const aesyClawError = AesyClawError.from(error);

  return {
    content: aesyClawError.message,
    isError: true,
    details: {
      code: aesyClawError.code,
      details: aesyClawError.details,
      timestamp: aesyClawError.timestamp,
    },
  };
}
