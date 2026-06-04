/**
 * 错误工厂函数
 *
 * 提供便捷的错误创建方法，统一错误实例化逻辑
 */

import { AesyClawError, ErrorCode, type ErrorDetails } from './base';
import { AgentExecutionError } from './agent';
import { ToolExecutionError } from './tool';
import { ConfigurationError } from './config';
import { ValidationError } from './validation';
import { ExtensionError } from './extension';

/**
 * 错误工厂类
 *
 * 提供静态方法创建各种类型的错误
 */
export class ErrorFactory {
  /**
   * 从任意错误创建 AesyClawError
   */
  static fromError(
    error: unknown,
    code = ErrorCode.UNKNOWN,
    details?: ErrorDetails,
  ): AesyClawError {
    return AesyClawError.from(error, code, details);
  }

  /**
   * 创建通用内部错误
   */
  static internal(message: string, details?: ErrorDetails, cause?: Error): AesyClawError {
    return new AesyClawError(ErrorCode.INTERNAL, message, details, cause);
  }

  /**
   * 创建未实现错误
   */
  static notImplemented(feature: string, details?: ErrorDetails): AesyClawError {
    return new AesyClawError(ErrorCode.NOT_IMPLEMENTED, `功能 "${feature}" 尚未实现`, details);
  }

  // ─── Agent 错误工厂方法 ───────────────────────────────────────

  static agent = {
    initializationFailed: AgentExecutionError.initializationFailed,
    processingFailed: AgentExecutionError.processingFailed,
    llmCallFailed: AgentExecutionError.llmCallFailed,
    roleNotFound: AgentExecutionError.roleNotFound,
    modelNotFound: AgentExecutionError.modelNotFound,
    promptBuildFailed: AgentExecutionError.promptBuildFailed,
    cancelled: AgentExecutionError.cancelled,
  };

  // ─── Tool 错误工厂方法 ────────────────────────────────────────

  static tool = {
    notFound: ToolExecutionError.notFound,
    executionFailed: ToolExecutionError.executionFailed,
    registrationFailed: ToolExecutionError.registrationFailed,
    duplicateName: ToolExecutionError.duplicateName,
    permissionDenied: ToolExecutionError.permissionDenied,
    invalidParams: ToolExecutionError.invalidParams,
    timeout: ToolExecutionError.timeout,
  };

  // ─── Config 错误工厂方法 ──────────────────────────────────────

  static config = {
    invalid: ConfigurationError.invalid,
    missing: ConfigurationError.missing,
    parseFailed: ConfigurationError.parseFailed,
    validationFailed: ConfigurationError.validationFailed,
    schemaMismatch: ConfigurationError.schemaMismatch,
  };

  // ─── Extension 错误工厂方法 ──────────────────────────────────

  static extension = {
    loadFailed: ExtensionError.loadFailed,
    initFailed: ExtensionError.initFailed,
    notFound: ExtensionError.notFound,
    alreadyRegistered: ExtensionError.alreadyRegistered,
    notLoaded: ExtensionError.notLoaded,
    permissionDenied: ExtensionError.permissionDenied,
  };

  // ─── Validation 错误工厂方法 ──────────────────────────────────

  static validation = {
    failed: ValidationError.failed,
    schemaInvalid: ValidationError.schemaInvalid,
    typeMismatch: ValidationError.typeMismatch,
    requiredFieldMissing: ValidationError.requiredFieldMissing,
    constraintViolation: ValidationError.constraintViolation,
  };
}

/**
 * 包装异步函数，捕获错误并转换为 AesyClawError
 *
 * @param fn - 要包装的异步函数
 * @param errorCode - 默认错误码
 * @param errorMessage - 默认错误消息
 * @returns 包装后的函数
 */
export function wrapAsync<T extends unknown[], R>(
  fn: (...args: T) => Promise<R>,
  errorCode: ErrorCode,
  errorMessage: string,
): (...args: T) => Promise<R> {
  return async (...args: T): Promise<R> => {
    try {
      return await fn(...args);
    } catch (error) {
      if (AesyClawError.isAesyClawError(error)) {
        throw error;
      }
      throw ErrorFactory.fromError(error, errorCode, { originalMessage: errorMessage });
    }
  };
}

/**
 * 包装同步函数，捕获错误并转换为 AesyClawError
 *
 * @param fn - 要包装的同步函数
 * @param errorCode - 默认错误码
 * @param errorMessage - 默认错误消息
 * @returns 包装后的函数
 */
export function wrapSync<T extends unknown[], R>(
  fn: (...args: T) => R,
  errorCode: ErrorCode,
  errorMessage: string,
): (...args: T) => R {
  return (...args: T): R => {
    try {
      return fn(...args);
    } catch (error) {
      if (AesyClawError.isAesyClawError(error)) {
        throw error;
      }
      throw ErrorFactory.fromError(error, errorCode, { originalMessage: errorMessage });
    }
  };
}
