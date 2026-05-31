/**
 * 验证相关错误
 */

import { AesyClawError, ErrorCode, type ErrorDetails } from './base';

/**
 * 验证错误
 *
 * 用于数据验证、Schema 验证、类型检查等过程中的错误
 */
export class ValidationError extends AesyClawError {
  /** 验证失败的字段路径 */
  readonly fieldPath?: string;

  /** 期望的值或类型 */
  readonly expected?: string;

  /** 实际的值或类型 */
  readonly actual?: string;

  /** 验证约束 */
  readonly constraint?: string;

  constructor(
    code: ErrorCode,
    message: string,
    details?: ErrorDetails & {
      fieldPath?: string;
      expected?: string;
      actual?: string;
      constraint?: string;
    },
    cause?: Error,
  ) {
    super(code, message, details, cause);
    this.fieldPath = details?.fieldPath;
    this.expected = details?.expected;
    this.actual = details?.actual;
    this.constraint = details?.constraint;
  }

  /**
   * 创建通用验证失败错误
   */
  static failed(message: string, details?: ErrorDetails, cause?: Error): ValidationError {
    return new ValidationError(ErrorCode.VALIDATION_FAILED, message, details, cause);
  }

  /**
   * 创建 Schema 无效错误
   */
  static schemaInvalid(message: string, details?: ErrorDetails, cause?: Error): ValidationError {
    return new ValidationError(
      ErrorCode.VALIDATION_SCHEMA_INVALID,
      `Schema 无效: ${message}`,
      details,
      cause,
    );
  }

  /**
   * 创建类型不匹配错误
   */
  static typeMismatch(
    fieldPath: string,
    expected: string,
    actual: string,
    details?: ErrorDetails,
  ): ValidationError {
    return new ValidationError(
      ErrorCode.VALIDATION_TYPE_MISMATCH,
      `字段 "${fieldPath}" 类型不匹配: 期望 ${expected}, 实际 ${actual}`,
      { ...details, fieldPath, expected, actual },
    );
  }

  /**
   * 创建必填字段缺失错误
   */
  static requiredFieldMissing(fieldPath: string, details?: ErrorDetails): ValidationError {
    return new ValidationError(
      ErrorCode.VALIDATION_REQUIRED_FIELD_MISSING,
      `必填字段 "${fieldPath}" 缺失`,
      { ...details, fieldPath },
    );
  }

  /**
   * 创建约束违反错误
   */
  static constraintViolation(
    fieldPath: string,
    constraint: string,
    message: string,
    details?: ErrorDetails,
  ): ValidationError {
    return new ValidationError(
      ErrorCode.VALIDATION_CONSTRAINT_VIOLATION,
      `字段 "${fieldPath}" 违反约束 "${constraint}": ${message}`,
      { ...details, fieldPath, constraint },
    );
  }
}
