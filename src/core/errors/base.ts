/**
 * AesyClaw 统一错误处理系统 - 基础错误类
 *
 * 提供错误码、详细信息、原因链等标准化错误属性。
 */

/**
 * 错误码枚举 - 使用分类前缀便于识别错误来源
 */
export enum ErrorCode {
  // 通用错误 (1000-1999)
  UNKNOWN = 'ERR_UNKNOWN',
  INTERNAL = 'ERR_INTERNAL',
  NOT_IMPLEMENTED = 'ERR_NOT_IMPLEMENTED',

  // Agent 错误 (2000-2999)
  AGENT_INITIALIZATION_FAILED = 'ERR_AGENT_INIT_FAILED',
  AGENT_PROCESSING_FAILED = 'ERR_AGENT_PROCESSING_FAILED',
  AGENT_LLM_CALL_FAILED = 'ERR_AGENT_LLM_CALL_FAILED',
  AGENT_ROLE_NOT_FOUND = 'ERR_AGENT_ROLE_NOT_FOUND',
  AGENT_MODEL_NOT_FOUND = 'ERR_AGENT_MODEL_NOT_FOUND',
  AGENT_PROMPT_BUILD_FAILED = 'ERR_AGENT_PROMPT_BUILD_FAILED',
  AGENT_CANCELLED = 'ERR_AGENT_CANCELLED',

  // 工具错误 (3000-3999)
  TOOL_NOT_FOUND = 'ERR_TOOL_NOT_FOUND',
  TOOL_EXECUTION_FAILED = 'ERR_TOOL_EXECUTION_FAILED',
  TOOL_REGISTRATION_FAILED = 'ERR_TOOL_REGISTRATION_FAILED',
  TOOL_DUPLICATE_NAME = 'ERR_TOOL_DUPLICATE_NAME',
  TOOL_PERMISSION_DENIED = 'ERR_TOOL_PERMISSION_DENIED',
  TOOL_INVALID_PARAMS = 'ERR_TOOL_INVALID_PARAMS',
  TOOL_TIMEOUT = 'ERR_TOOL_TIMEOUT',

  // 配置错误 (4000-4999)
  CONFIG_INVALID = 'ERR_CONFIG_INVALID',
  CONFIG_MISSING = 'ERR_CONFIG_MISSING',
  CONFIG_PARSE_FAILED = 'ERR_CONFIG_PARSE_FAILED',
  CONFIG_VALIDATION_FAILED = 'ERR_CONFIG_VALIDATION_FAILED',
  CONFIG_SCHEMA_MISMATCH = 'ERR_CONFIG_SCHEMA_MISMATCH',

  // 验证错误 (5000-5999)
  VALIDATION_FAILED = 'ERR_VALIDATION_FAILED',
  VALIDATION_SCHEMA_INVALID = 'ERR_VALIDATION_SCHEMA_INVALID',
  VALIDATION_TYPE_MISMATCH = 'ERR_VALIDATION_TYPE_MISMATCH',
  VALIDATION_REQUIRED_FIELD_MISSING = 'ERR_VALIDATION_REQUIRED_FIELD_MISSING',
  VALIDATION_CONSTRAINT_VIOLATION = 'ERR_VALIDATION_CONSTRAINT_VIOLATION',

  // 会话错误 (6000-6999)
  SESSION_NOT_FOUND = 'ERR_SESSION_NOT_FOUND',
  SESSION_LOCKED = 'ERR_SESSION_LOCKED',
  SESSION_CREATION_FAILED = 'ERR_SESSION_CREATION_FAILED',

  // 扩展错误 (7000-7999)
  EXTENSION_LOAD_FAILED = 'ERR_EXTENSION_LOAD_FAILED',
  EXTENSION_INIT_FAILED = 'ERR_EXTENSION_INIT_FAILED',
  EXTENSION_NOT_FOUND = 'ERR_EXTENSION_NOT_FOUND',
  EXTENSION_PERMISSION_DENIED = 'ERR_EXTENSION_PERMISSION_DENIED',

  // Hook 错误 (8000-8999)
  HOOK_EXECUTION_FAILED = 'ERR_HOOK_EXECUTION_FAILED',
  HOOK_MIDDLEWARE_FAILED = 'ERR_HOOK_MIDDLEWARE_FAILED',
}

/**
 * 错误详细信息类型 - 可以包含任意结构化数据
 */
export type ErrorDetails = Record<string, unknown>;

/**
 * AesyClaw 基础错误类
 *
 * 所有自定义错误的基类，提供：
 * - code: 错误码，便于程序化处理
 * - message: 人类可读的错误描述
 * - details: 结构化的详细信息
 * - cause: 原始错误（错误链）
 * - timestamp: 错误发生时间
 * - stack: 堆栈跟踪
 */
export class AesyClawError extends Error {
  /** 错误码 */
  readonly code: ErrorCode;

  /** 详细信息 */
  readonly details?: ErrorDetails;

  /** 原因链 - 原始错误 */
  readonly cause?: Error;

  /** 错误发生时间 */
  readonly timestamp: Date;

  /**
   * 创建 AesyClaw 错误实例
   *
   * @param code - 错误码
   * @param message - 错误消息
   * @param details - 可选的详细信息
   * @param cause - 可选的原始错误
   */
  constructor(code: ErrorCode, message: string, details?: ErrorDetails, cause?: Error) {
    super(message);

    // 设置正确的原型链（TypeScript 继承 Error 的已知问题）
    Object.setPrototypeOf(this, new.target.prototype);

    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
    this.cause = cause;
    this.timestamp = new Date();

    // 捕获堆栈跟踪
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * 将错误转换为 JSON 格式
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
      timestamp: this.timestamp.toISOString(),
      cause:
        this.cause !== undefined
          ? {
              name: this.cause.name,
              message: this.cause.message,
              stack: this.cause.stack,
            }
          : undefined,
      stack: this.stack,
    };
  }

  /**
   * 将错误转换为用户友好的字符串
   */
  toString(): string {
    let result = `${this.name} [${this.code}]: ${this.message}`;

    if (this.details !== undefined && Object.keys(this.details).length > 0) {
      result += `\n详细信息: ${JSON.stringify(this.details, null, 2)}`;
    }

    if (this.cause !== undefined) {
      result += `\n原因: ${this.cause.message}`;
    }

    return result;
  }

  /**
   * 检查错误是否为 AesyClawError 实例
   */
  static isAesyClawError(error: unknown): error is AesyClawError {
    return error instanceof AesyClawError;
  }

  /**
   * 从任意错误创建 AesyClawError
   */
  static from(error: unknown, code = ErrorCode.UNKNOWN, details?: ErrorDetails): AesyClawError {
    if (error instanceof AesyClawError) {
      return error;
    }

    if (error instanceof Error) {
      return new AesyClawError(code, error.message, details, error);
    }

    const message = String(error);
    return new AesyClawError(code, message, details);
  }
}
