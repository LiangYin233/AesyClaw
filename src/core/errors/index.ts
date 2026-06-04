/**
 * 统一错误处理系统
 *
 * 导出所有错误类型、工厂函数、中间件和工具
 */

// 基础错误类和错误码
export { AesyClawError, ErrorCode, type ErrorDetails } from './base';

// 专门的错误类型
export { AgentExecutionError } from './agent';
export { ToolExecutionError } from './tool';
export { ConfigurationError } from './config';
export { ValidationError } from './validation';
export { ExtensionError, type ExtensionKind } from './extension';

// 错误工厂
export { ErrorFactory, wrapAsync, wrapSync } from './factory';

// 错误追踪
export {
  ErrorTracker,
  type ErrorRecord,
  type ErrorStats,
  type ErrorTrackerConfig,
} from './tracker';

// 错误处理中间件
export {
  createErrorMiddleware,
  createToolErrorMiddleware,
  type ErrorMiddlewareOptions,
} from './middleware';

// 错误处理工具
export {
  errorMessage,
  safeExecute,
  safeExecuteSync,
  executeWithTimeout,
  logAndThrow,
  isErrorCode,
  isErrorType,
  getUserFriendlyMessage,
  errorToToolResult,
} from './utils';
