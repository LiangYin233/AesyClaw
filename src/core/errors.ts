/**
 * Custom error class for AesyClaw.
 *
 * Startup failures cascade to shutdown; runtime failures are contained and logged.
 * See error-handling.md for the full strategy.
 */

/** Error codes used to distinguish error types at catch sites */
type AppErrorCode = 'CONFIG_VALIDATION' | 'PLUGIN_INIT' | 'CHANNEL_INIT' | 'MCP_CONNECTION';

/** Single application error with a machine-readable code */
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
