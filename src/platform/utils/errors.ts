/** @file 错误处理工具
 *
 * 将任意错误值安全地转换为字符串消息。
 * 用于统一错误日志与返回给用户的错误描述。
 */

/** 将错误值转换为字符串消息 */
export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
