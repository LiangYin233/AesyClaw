/**
 * 错误处理辅助工具
 */

import { AesyClawError } from './base';

/**
 * 将任意错误对象转为字符串消息。
 */
export function errorMessage(error: unknown): string {
  if (AesyClawError.isAesyClawError(error)) {
    return error.message;
  }

  return error instanceof Error ? error.message : String(error);
}
