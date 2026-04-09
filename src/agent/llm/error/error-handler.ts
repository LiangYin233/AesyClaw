/**
 * 错误处理器和重试策略模块
 * 提供统一的错误处理和自动重试机制
 */

import { ErrorInfo, ErrorType, RetryPolicy } from '../types.js';
import { logger } from '../../../platform/observability/logger.js';

export { ErrorType, ErrorInfo, RetryPolicy };

/**
 * 默认重试策略配置
 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
  retryableErrors: [
    ErrorType.NETWORK_ERROR,
    ErrorType.CONNECTION_RESET,
    ErrorType.TIMEOUT,
    ErrorType.DNS_ERROR,
    ErrorType.RATE_LIMIT,
    ErrorType.OVERLOADED,
    ErrorType.INTERNAL_ERROR,
  ],
  enableJitter: true,
  jitterFactor: 0.3,
};

/**
 * 重试统计信息
 */
export interface RetryStats {
  /** 总尝试次数 */
  totalAttempts: number;
  /** 重试次数 */
  retryCount: number;
  /** 最后一次错误 */
  lastError?: ErrorInfo;
  /** 总等待时间（毫秒） */
  totalWaitTime: number;
}

/**
 * 重试回调函数类型
 */
export type RetryCallback = (info: {
  attempt: number;
  maxRetries: number;
  errorInfo: ErrorInfo;
  waitTime: number;
}) => void;

/**
 * 错误处理器类
 * 提供统一的错误分类和重试机制
 */
export class ErrorHandler {
  private policy: RetryPolicy;

  constructor(policy: Partial<RetryPolicy> = {}) {
    this.policy = { ...DEFAULT_RETRY_POLICY, ...policy };
  }

  /**
   * 使用重试机制执行异步操作
   * @param operation 要执行的异步操作
   * @param operationName 操作名称（用于日志）
   * @param onRetry 重试回调函数（可选）
   * @returns 操作结果
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string = 'operation',
    onRetry?: RetryCallback
  ): Promise<T> {
    const stats: RetryStats = {
      totalAttempts: 0,
      retryCount: 0,
      totalWaitTime: 0,
    };

    let lastError: ErrorInfo | undefined;

    while (stats.totalAttempts <= this.policy.maxRetries) {
      stats.totalAttempts++;

      try {
        logger.debug(
          {
            operationName,
            attempt: stats.totalAttempts,
            maxRetries: this.policy.maxRetries,
          },
          `🔄 执行操作: ${operationName} (尝试 ${stats.totalAttempts}/${this.policy.maxRetries + 1})`
        );

        const result = await operation();

        if (stats.retryCount > 0) {
          logger.info(
            {
              operationName,
              retryCount: stats.retryCount,
              totalAttempts: stats.totalAttempts,
              totalWaitTime: stats.totalWaitTime,
            },
            `✅ 操作成功: ${operationName} (经过 ${stats.retryCount} 次重试)`
          );
        }

        return result;
      } catch (error) {
        lastError = this.classifyError(error);
        stats.lastError = lastError;

        logger.warn(
          {
            operationName,
            attempt: stats.totalAttempts,
            errorType: lastError.type,
            errorMessage: lastError.message,
            retryable: lastError.retryable,
          },
          `⚠️ 操作失败: ${operationName} - ${lastError.message}`
        );

        // 检查是否可以重试
        if (!this.canRetry(lastError, stats.totalAttempts)) {
          logger.error(
            {
              operationName,
              errorType: lastError.type,
              retryCount: stats.retryCount,
              totalAttempts: stats.totalAttempts,
            },
            `❌ 操作最终失败: ${operationName} - 不可重试或已达到最大重试次数`
          );

          throw this.createEnhancedError(lastError, stats);
        }

        // 计算等待时间
        const waitTime = this.calculateWaitTime(stats.retryCount, lastError.retryAfter);
        stats.totalWaitTime += waitTime;
        stats.retryCount++;

        logger.info(
          {
            operationName,
            retryCount: stats.retryCount,
            waitTime,
            errorType: lastError.type,
          },
          `⏳ 等待 ${waitTime}ms 后重试 (${stats.retryCount}/${this.policy.maxRetries})`
        );

        // 调用重试回调
        if (onRetry) {
          onRetry({
            attempt: stats.retryCount,
            maxRetries: this.policy.maxRetries,
            errorInfo: lastError,
            waitTime,
          });
        }

        // 等待后重试
        await this.sleep(waitTime);
      }
    }

    // 理论上不应该到达这里，但为了类型安全
    throw this.createEnhancedError(lastError!, stats);
  }

  /**
   * 分类错误
   * @param error 原始错误对象
   * @returns 错误信息
   */
  classifyError(error: unknown): ErrorInfo {
    const err = error instanceof Error ? error : new Error(String(error));

    if (this.isNetworkError(err)) {
      return {
        type: ErrorType.NETWORK_ERROR,
        originalError: err,
        message: err.message || '网络连接错误',
        code: (error as { code?: string }).code,
        retryable: true,
      };
    }

    const errorCode = (error as { code?: string }).code;

    if (errorCode === 'ECONNRESET') {
      return {
        type: ErrorType.CONNECTION_RESET,
        originalError: err,
        message: '连接被重置',
        code: errorCode,
        retryable: true,
      };
    }

    if (errorCode === 'ETIMEDOUT' || errorCode === 'ESOCKETTIMEDOUT') {
      return {
        type: ErrorType.TIMEOUT,
        originalError: err,
        message: '请求超时',
        code: errorCode,
        retryable: true,
      };
    }

    if (errorCode === 'ENOTFOUND' || errorCode === 'EAI_AGAIN') {
      return {
        type: ErrorType.DNS_ERROR,
        originalError: err,
        message: 'DNS 解析失败',
        code: errorCode,
        retryable: true,
      };
    }

    const httpError = error as { status?: number; statusCode?: number; response?: { status?: number } };
    if (httpError.status || httpError.statusCode || httpError.response?.status) {
      return this.classifyHttpError(error);
    }

    const apiError = error as { error?: { type?: string; message?: string }; type?: string };
    if (apiError.error?.type || apiError.type) {
      return this.classifyApiError(error);
    }

    return {
      type: ErrorType.UNKNOWN,
      originalError: err,
      message: err.message || '未知错误',
      retryable: false,
    };
  }

  /**
   * 分类 HTTP 错误
   */
  private classifyHttpError(error: unknown): ErrorInfo {
    const httpError = error as {
      status?: number;
      statusCode?: number;
      response?: { status?: number };
      message?: string;
      headers?: Record<string, unknown>;
    };
    const statusCode = httpError.status || httpError.statusCode || httpError.response?.status;
    const message = httpError.message || `HTTP ${statusCode} 错误`;
    const err = error instanceof Error ? error : new Error(String(error));

    if (statusCode === 401) {
      return {
        type: ErrorType.AUTHENTICATION_ERROR,
        originalError: err,
        message: '认证失败，请检查 API 密钥',
        statusCode,
        retryable: false,
      };
    }

    if (statusCode === 403) {
      return {
        type: ErrorType.AUTHORIZATION_ERROR,
        originalError: err,
        message: '权限不足，无法访问资源',
        statusCode,
        retryable: false,
      };
    }

    if (statusCode === 404) {
      return {
        type: ErrorType.NOT_FOUND,
        originalError: err,
        message: '请求的资源不存在',
        statusCode,
        retryable: false,
      };
    }

    if (statusCode === 429) {
      const retryAfter = this.parseRetryAfter(error);
      return {
        type: ErrorType.RATE_LIMIT,
        originalError: err,
        message: '请求频率超限，请稍后重试',
        statusCode,
        retryable: true,
        retryAfter,
      };
    }

    if (statusCode === 400) {
      return {
        type: ErrorType.INVALID_REQUEST,
        originalError: err,
        message: '请求参数错误',
        statusCode,
        retryable: false,
      };
    }

    if (statusCode !== undefined && statusCode >= 500) {
      return {
        type: ErrorType.INTERNAL_ERROR,
        originalError: err,
        message: `服务器内部错误 (${statusCode})`,
        statusCode,
        retryable: true,
      };
    }

    return {
      type: ErrorType.UNKNOWN,
      originalError: err,
      message,
      statusCode,
      retryable: false,
    };
  }

  /**
   * 分类 API 特定错误
   */
  private classifyApiError(error: unknown): ErrorInfo {
    const apiError = error as {
      error?: { type?: string; message?: string };
      type?: string;
      message?: string;
      code?: string;
    };
    const errorType = apiError.error?.type || apiError.type;
    const message = apiError.error?.message || apiError.message || 'API 错误';
    const err = error instanceof Error ? error : new Error(String(error));

    if (errorType === 'rate_limit_error' || errorType === 'rate_limit_exceeded') {
      return {
        type: ErrorType.RATE_LIMIT,
        originalError: err,
        message: 'API 请求频率超限',
        retryable: true,
        retryAfter: this.parseRetryAfter(error),
      };
    }

    if (errorType === 'overloaded_error' || errorType === 'overloaded') {
      return {
        type: ErrorType.OVERLOADED,
        originalError: err,
        message: 'API 服务过载',
        retryable: true,
      };
    }

    if (errorType === 'internal_error') {
      return {
        type: ErrorType.INTERNAL_ERROR,
        originalError: err,
        message: 'API 内部错误',
        retryable: true,
      };
    }

    if (errorType === 'authentication_error' || errorType === 'invalid_api_key') {
      return {
        type: ErrorType.AUTHENTICATION_ERROR,
        originalError: err,
        message: 'API 认证失败',
        retryable: false,
      };
    }

    if (errorType === 'permission_error' || errorType === 'permission_denied') {
      return {
        type: ErrorType.AUTHORIZATION_ERROR,
        originalError: err,
        message: 'API 权限不足',
        retryable: false,
      };
    }

    if (errorType === 'not_found_error') {
      return {
        type: ErrorType.NOT_FOUND,
        originalError: err,
        message: 'API 资源不存在',
        retryable: false,
      };
    }

    if (errorType === 'invalid_request_error') {
      return {
        type: ErrorType.INVALID_REQUEST,
        originalError: err,
        message: 'API 请求参数无效',
        retryable: false,
      };
    }

    if (errorType === 'content_filter' || apiError.code === 'content_filter') {
      return {
        type: ErrorType.CONTENT_FILTER,
        originalError: err,
        message: '内容被过滤',
        retryable: false,
      };
    }

    return {
      type: ErrorType.UNKNOWN,
      originalError: err,
      message,
      retryable: false,
    };
  }

  /**
   * 检查是否为网络错误
   */
  private isNetworkError(error: Error): boolean {
    const networkErrorCodes = [
      'ECONNREFUSED',
      'EPIPE',
      'EHOSTUNREACH',
      'ENETUNREACH',
      'ECONNABORTED',
    ];

    const errorWithCode = error as Error & { code?: string };
    const errorCode = errorWithCode.code;

    return (
      (errorCode && networkErrorCodes.includes(errorCode)) ||
      errorCode === 'NETWORK_ERROR' ||
      error.message.includes('network') ||
      error.message.includes('ECONNREFUSED')
    );
  }

  /**
   * 解析 Retry-After 头
   */
  private parseRetryAfter(error: unknown): number | undefined {
    const err = error as {
      headers?: Record<string, unknown>;
      response?: { headers?: Record<string, unknown> };
      error?: { retry_after?: unknown };
    };
    const retryAfter = 
      err.headers?.['retry-after'] ||
      err.response?.headers?.['retry-after'] ||
      err.error?.retry_after;

    if (retryAfter !== undefined && retryAfter !== null) {
      const retryAfterStr = String(retryAfter);
      const seconds = parseFloat(retryAfterStr);
      if (!isNaN(seconds)) {
        return seconds * 1000;
      }

      const date = new Date(retryAfterStr);
      if (!isNaN(date.getTime())) {
        return Math.max(0, date.getTime() - Date.now());
      }
    }

    return undefined;
  }

  /**
   * 检查是否可以重试
   */
  private canRetry(errorInfo: ErrorInfo, currentAttempt: number): boolean {
    // 检查是否已达到最大重试次数
    if (currentAttempt > this.policy.maxRetries) {
      return false;
    }

    // 检查错误类型是否在可重试列表中
    return this.policy.retryableErrors.includes(errorInfo.type);
  }

  /**
   * 计算等待时间（指数退避 + 抖动）
   */
  private calculateWaitTime(retryCount: number, retryAfter?: number): number {
    // 如果有明确的 retry-after 时间，使用它
    if (retryAfter && retryAfter > 0) {
      return Math.min(retryAfter, this.policy.maxDelay);
    }

    // 计算指数退避时间
    let delay = this.policy.initialDelay * Math.pow(this.policy.backoffMultiplier, retryCount);

    // 应用最大延迟限制
    delay = Math.min(delay, this.policy.maxDelay);

    // 应用抖动
    if (this.policy.enableJitter && this.policy.jitterFactor) {
      const jitter = delay * this.policy.jitterFactor * Math.random();
      delay = delay + jitter - (delay * this.policy.jitterFactor) / 2;
    }

    return Math.floor(delay);
  }

  /**
   * 创建增强的错误对象
   */
  private createEnhancedError(errorInfo: ErrorInfo, stats: RetryStats): Error {
    const error = new Error(
      `${errorInfo.message} (尝试 ${stats.totalAttempts} 次, 重试 ${stats.retryCount} 次)`
    );
    const enhancedError = error as Error & { errorInfo: ErrorInfo; retryStats: RetryStats };
    enhancedError.errorInfo = errorInfo;
    enhancedError.retryStats = stats;
    return error;
  }

  /**
   * 异步等待
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 获取当前重试策略
   */
  updatePolicy(policy: Partial<RetryPolicy>): void {
    this.policy = { ...this.policy, ...policy };
    logger.info({ policy: this.policy }, '📝 重试策略已更新');
  }
}
