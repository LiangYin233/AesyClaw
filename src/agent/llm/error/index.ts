/**
 * 错误处理模块
 * 导出错误处理器和重试策略相关的类型和函数
 */

export {
  ErrorHandler,
  ErrorType,
  ErrorInfo,
  RetryPolicy,
  RetryStats,
  RetryCallback,
  DEFAULT_RETRY_POLICY,
  createErrorHandler,
} from './error-handler.js';
