/**
 * AesyClaw 的自定义错误类。
 *
 * 启动失败会级联到关闭；运行时失败被包含并记录。
 * 完整策略请参阅 error-handling.md。
 */

/** 用于在捕获点区分错误类型的错误码 */
type AppErrorCode = 'CONFIG_VALIDATION' | 'PLUGIN_INIT' | 'CHANNEL_INIT' | 'MCP_CONNECTION';

/** 带机器可读代码的单一应用错误 */
class AppError extends Error {
  public readonly code: AppErrorCode;
  public readonly details?: unknown;

  constructor(message: string, code: AppErrorCode, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }
}

export type { AppErrorCode };
export { AppError };
