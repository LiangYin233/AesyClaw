/**
 * 错误处理中间件
 *
 * 为 Hook 系统提供统一的错误处理中间件
 */

import type { HookCtx, HookResult, Middleware } from '@aesyclaw/contracts/hook';
import { AesyClawError, ErrorCode } from './base';
import { createScopedLogger } from '@aesyclaw/core/logger';
import { ErrorTracker } from './tracker';

const logger = createScopedLogger('error-middleware');

/**
 * 错误处理中间件选项
 */
export type ErrorMiddlewareOptions = {
  /** 是否记录错误到日志 */
  logErrors?: boolean;
  /** 是否追踪错误 */
  trackErrors?: boolean;
  /** 错误追踪器实例 */
  tracker?: ErrorTracker;
  /** 自定义错误转换函数 */
  transformError?: (error: unknown, ctx: HookCtx) => AesyClawError;
  /** 自定义错误响应生成函数 */
  formatErrorResponse?: (error: AesyClawError, ctx: HookCtx) => string;
};

/**
 * 创建错误处理中间件
 *
 * 捕获 Hook 链中的错误，转换为统一的 AesyClawError，
 * 并返回格式化的错误响应
 *
 * @param options - 中间件选项
 * @returns Hook 中间件函数
 */
export function createErrorMiddleware(options: ErrorMiddlewareOptions = {}): Middleware {
  const {
    logErrors = true,
    trackErrors = true,
    tracker = ErrorTracker.getInstance(),
    transformError = defaultTransformError,
    formatErrorResponse = defaultFormatErrorResponse,
  } = options;

  return async (ctx: HookCtx, next?: () => Promise<HookResult>): Promise<HookResult> => {
    try {
      // 调用下一个中间件
      if (!next) {
        return { action: 'next' };
      }
      return await next();
    } catch (error) {
      // 转换为 AesyClawError
      const aesyClawError = transformError(error, ctx);

      // 记录错误
      if (logErrors) {
        logger.error('Hook 执行错误', {
          code: aesyClawError.code,
          message: aesyClawError.message,
          details: aesyClawError.details,
          sessionKey: ctx.sessionKey,
          toolName: ctx.toolName,
        });
      }

      // 追踪错误
      if (trackErrors) {
        tracker.track(aesyClawError, {
          hookChain: 'unknown', // 可以从上下文中获取
          sessionKey: ctx.sessionKey,
          toolName: ctx.toolName,
        });
      }

      // 返回错误响应
      const errorMessage = formatErrorResponse(aesyClawError, ctx);
      return {
        action: 'respond',
        message: {
          components: [{ type: 'Plain', text: errorMessage }],
        },
      };
    }
  };
}

/**
 * 默认错误转换函数
 */
function defaultTransformError(error: unknown, _ctx: HookCtx): AesyClawError {
  if (AesyClawError.isAesyClawError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return new AesyClawError(ErrorCode.HOOK_EXECUTION_FAILED, error.message, undefined, error);
  }

  return new AesyClawError(ErrorCode.HOOK_EXECUTION_FAILED, String(error));
}

/**
 * 默认错误响应格式化函数
 */
function defaultFormatErrorResponse(error: AesyClawError, _ctx: HookCtx): string {
  let message = `❌ 错误 [${error.code}]: ${error.message}`;

  if (error.details && Object.keys(error.details).length > 0) {
    message += `\n\n详细信息:\n${JSON.stringify(error.details, null, 2)}`;
  }

  if (error.cause) {
    message += `\n\n原因: ${error.cause.message}`;
  }

  return message;
}

/**
 * 创建工具执行错误处理中间件
 *
 * 专门用于 tool:beforeCall 和 tool:afterCall Hook 链
 */
export function createToolErrorMiddleware(options: ErrorMiddlewareOptions = {}): Middleware {
  return createErrorMiddleware({
    ...options,
    transformError: (error, ctx) => {
      if (AesyClawError.isAesyClawError(error)) {
        return error;
      }

      const toolName = ctx.toolName ?? 'unknown';
      if (error instanceof Error) {
        return new AesyClawError(
          ErrorCode.TOOL_EXECUTION_FAILED,
          `工具 "${toolName}" 执行失败: ${error.message}`,
          { toolName },
          error,
        );
      }

      return new AesyClawError(
        ErrorCode.TOOL_EXECUTION_FAILED,
        `工具 "${toolName}" 执行失败: ${String(error)}`,
        { toolName },
      );
    },
  });
}
