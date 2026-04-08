/**
 * 错误处理器和重试策略模块
 * 提供统一的错误处理和自动重试机制
 */

import { logger } from '../../../platform/observability/logger.js';

/**
 * 错误类型枚举
 * 用于分类不同类型的错误，决定是否需要重试
 */
export enum ErrorType {
  /** 网络错误 - 可重试 */
  NETWORK_ERROR = 'network_error',
  /** 连接重置 - 可重试 */
  CONNECTION_RESET = 'connection_reset',
  /** 连接超时 - 可重试 */
  TIMEOUT = 'timeout',
  /** DNS 解析失败 - 可重试 */
  DNS_ERROR = 'dns_error',
  /** 限流错误 - 可重试（需要等待） */
  RATE_LIMIT = 'rate_limit',
  /** 服务过载 - 可重试 */
  OVERLOADED = 'overloaded',
  /** 内部错误 - 可重试 */
  INTERNAL_ERROR = 'internal_error',
  /** 认证错误 - 不可重试 */
  AUTHENTICATION_ERROR = 'authentication_error',
  /** 授权错误 - 不可重试 */
  AUTHORIZATION_ERROR = 'authorization_error',
  /** 参数错误 - 不可重试 */
  INVALID_REQUEST = 'invalid_request',
  /** 资源未找到 - 不可重试 */
  NOT_FOUND = 'not_found',
  /** 内容过滤 - 不可重试 */
  CONTENT_FILTER = 'content_filter',
  /** 未知错误 - 默认不可重试 */
  UNKNOWN = 'unknown',
}

/**
 * 错误信息接口
 */
export interface ErrorInfo {
  /** 错误类型 */
  type: ErrorType;
  /** 原始错误对象 */
  originalError: Error;
  /** 错误消息 */
  message: string;
  /** HTTP 状态码（如果适用） */
  statusCode?: number;
  /** 错误代码 */
  code?: string;
  /** 是否可重试 */
  retryable: boolean;
  /** 重试等待时间（毫秒，如果适用） */
  retryAfter?: number;
}

/**
 * 重试策略配置接口
 */
export interface RetryPolicy {
  /** 最大重试次数 */
  maxRetries: number;
  /** 初始延迟时间（毫秒） */
  initialDelay: number;
  /** 最大延迟时间（毫秒） */
  maxDelay: number;
  /** 退避倍数 */
  backoffMultiplier: number;
  /** 可重试的错误类型 */
  retryableErrors: ErrorType[];
  /** 是否启用抖动（jitter）以避免重试风暴 */
  enableJitter?: boolean;
  /** 抖动因子（0-1之间） */
  jitterFactor?: number;
}

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
  classifyError(error: any): ErrorInfo {
    // 处理网络错误
    if (this.isNetworkError(error)) {
      return {
        type: ErrorType.NETWORK_ERROR,
        originalError: error,
        message: error.message || '网络连接错误',
        code: error.code,
        retryable: true,
      };
    }

    // 处理连接重置
    if (error.code === 'ECONNRESET') {
      return {
        type: ErrorType.CONNECTION_RESET,
        originalError: error,
        message: '连接被重置',
        code: error.code,
        retryable: true,
      };
    }

    // 处理超时
    if (error.code === 'ETIMEDOUT' || error.code === 'ESOCKETTIMEDOUT') {
      return {
        type: ErrorType.TIMEOUT,
        originalError: error,
        message: '请求超时',
        code: error.code,
        retryable: true,
      };
    }

    // 处理 DNS 错误
    if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') {
      return {
        type: ErrorType.DNS_ERROR,
        originalError: error,
        message: 'DNS 解析失败',
        code: error.code,
        retryable: true,
      };
    }

    // 处理 HTTP 错误
    if (error.status || error.statusCode || error.response?.status) {
      return this.classifyHttpError(error);
    }

    // 处理 API 特定错误
    if (error.error?.type || error.type) {
      return this.classifyApiError(error);
    }

    // 未知错误
    return {
      type: ErrorType.UNKNOWN,
      originalError: error,
      message: error.message || '未知错误',
      retryable: false,
    };
  }

  /**
   * 分类 HTTP 错误
   */
  private classifyHttpError(error: any): ErrorInfo {
    const statusCode = error.status || error.statusCode || error.response?.status;
    const message = error.message || `HTTP ${statusCode} 错误`;

    // 401 认证错误
    if (statusCode === 401) {
      return {
        type: ErrorType.AUTHENTICATION_ERROR,
        originalError: error,
        message: '认证失败，请检查 API 密钥',
        statusCode,
        retryable: false,
      };
    }

    // 403 授权错误
    if (statusCode === 403) {
      return {
        type: ErrorType.AUTHORIZATION_ERROR,
        originalError: error,
        message: '权限不足，无法访问资源',
        statusCode,
        retryable: false,
      };
    }

    // 404 未找到
    if (statusCode === 404) {
      return {
        type: ErrorType.NOT_FOUND,
        originalError: error,
        message: '请求的资源不存在',
        statusCode,
        retryable: false,
      };
    }

    // 429 限流
    if (statusCode === 429) {
      const retryAfter = this.parseRetryAfter(error);
      return {
        type: ErrorType.RATE_LIMIT,
        originalError: error,
        message: '请求频率超限，请稍后重试',
        statusCode,
        retryable: true,
        retryAfter,
      };
    }

    // 400 参数错误
    if (statusCode === 400) {
      return {
        type: ErrorType.INVALID_REQUEST,
        originalError: error,
        message: '请求参数错误',
        statusCode,
        retryable: false,
      };
    }

    // 500+ 服务器错误
    if (statusCode >= 500) {
      return {
        type: ErrorType.INTERNAL_ERROR,
        originalError: error,
        message: `服务器内部错误 (${statusCode})`,
        statusCode,
        retryable: true,
      };
    }

    // 其他 HTTP 错误
    return {
      type: ErrorType.UNKNOWN,
      originalError: error,
      message,
      statusCode,
      retryable: false,
    };
  }

  /**
   * 分类 API 特定错误
   */
  private classifyApiError(error: any): ErrorInfo {
    const errorType = error.error?.type || error.type;
    const message = error.error?.message || error.message || 'API 错误';

    // Anthropic 错误类型
    if (errorType === 'rate_limit_error' || errorType === 'rate_limit_exceeded') {
      return {
        type: ErrorType.RATE_LIMIT,
        originalError: error,
        message: 'API 请求频率超限',
        retryable: true,
        retryAfter: this.parseRetryAfter(error),
      };
    }

    if (errorType === 'overloaded_error' || errorType === 'overloaded') {
      return {
        type: ErrorType.OVERLOADED,
        originalError: error,
        message: 'API 服务过载',
        retryable: true,
      };
    }

    if (errorType === 'internal_error') {
      return {
        type: ErrorType.INTERNAL_ERROR,
        originalError: error,
        message: 'API 内部错误',
        retryable: true,
      };
    }

    if (errorType === 'authentication_error' || errorType === 'invalid_api_key') {
      return {
        type: ErrorType.AUTHENTICATION_ERROR,
        originalError: error,
        message: 'API 认证失败',
        retryable: false,
      };
    }

    if (errorType === 'permission_error' || errorType === 'permission_denied') {
      return {
        type: ErrorType.AUTHORIZATION_ERROR,
        originalError: error,
        message: 'API 权限不足',
        retryable: false,
      };
    }

    if (errorType === 'not_found_error') {
      return {
        type: ErrorType.NOT_FOUND,
        originalError: error,
        message: 'API 资源不存在',
        retryable: false,
      };
    }

    if (errorType === 'invalid_request_error') {
      return {
        type: ErrorType.INVALID_REQUEST,
        originalError: error,
        message: 'API 请求参数无效',
        retryable: false,
      };
    }

    // OpenAI 内容过滤
    if (errorType === 'content_filter' || error.code === 'content_filter') {
      return {
        type: ErrorType.CONTENT_FILTER,
        originalError: error,
        message: '内容被过滤',
        retryable: false,
      };
    }

    return {
      type: ErrorType.UNKNOWN,
      originalError: error,
      message,
      retryable: false,
    };
  }

  /**
   * 检查是否为网络错误
   */
  private isNetworkError(error: any): boolean {
    const networkErrorCodes = [
      'ECONNREFUSED',
      'EPIPE',
      'EHOSTUNREACH',
      'ENETUNREACH',
      'ECONNABORTED',
    ];

    return (
      networkErrorCodes.includes(error.code) ||
      error.code === 'NETWORK_ERROR' ||
      error.message?.includes('network') ||
      error.message?.includes('ECONNREFUSED')
    );
  }

  /**
   * 解析 Retry-After 头
   */
  private parseRetryAfter(error: any): number | undefined {
    const retryAfter =
      error.headers?.['retry-after'] ||
      error.response?.headers?.['retry-after'] ||
      error.error?.retry_after;

    if (retryAfter) {
      // 如果是数字或数字字符串，视为秒数（支持小数）
      const seconds = parseFloat(retryAfter);
      if (!isNaN(seconds)) {
        return seconds * 1000; // 转换为毫秒
      }

      // 如果是日期字符串，计算剩余时间
      const date = new Date(retryAfter);
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
    (error as any).errorInfo = errorInfo;
    (error as any).retryStats = stats;
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
  getPolicy(): Readonly<RetryPolicy> {
    return { ...this.policy };
  }

  /**
   * 更新重试策略
   */
  updatePolicy(policy: Partial<RetryPolicy>): void {
    this.policy = { ...this.policy, ...policy };
    logger.info({ policy: this.policy }, '📝 重试策略已更新');
  }
}

/**
 * 创建默认错误处理器实例
 */
export function createErrorHandler(policy?: Partial<RetryPolicy>): ErrorHandler {
  return new ErrorHandler(policy);
}
