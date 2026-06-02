/**
 * 工具执行相关错误
 */

import { AesyClawError, ErrorCode, type ErrorDetails } from './base';

/**
 * 工具执行错误
 *
 * 用于工具注册、执行、权限检查等过程中的错误
 */
export class ToolExecutionError extends AesyClawError {
  /** 工具名称 */
  readonly toolName?: string;

  /** 工具所有者 */
  readonly owner?: string;

  /** 工具参数 */
  readonly params?: unknown;

  constructor(
    code: ErrorCode,
    message: string,
    details?: ErrorDetails & {
      toolName?: string;
      owner?: string;
      params?: unknown;
    },
    cause?: Error,
  ) {
    super(code, message, details, cause);
    this.toolName = details?.toolName;
    this.owner = details?.owner;
    this.params = details?.params;
  }

  /**
   * 创建工具未找到错误
   */
  static notFound(toolName: string, details?: ErrorDetails): ToolExecutionError {
    return new ToolExecutionError(ErrorCode.TOOL_NOT_FOUND, `工具 "${toolName}" 未找到`, {
      ...details,
      toolName,
    });
  }

  /**
   * 创建工具执行失败错误
   */
  static executionFailed(
    toolName: string,
    message: string,
    details?: ErrorDetails,
    cause?: Error,
  ): ToolExecutionError {
    return new ToolExecutionError(
      ErrorCode.TOOL_EXECUTION_FAILED,
      `工具 "${toolName}" 执行失败: ${message}`,
      { ...details, toolName },
      cause,
    );
  }

  /**
   * 创建工具注册失败错误
   */
  static registrationFailed(
    toolName: string,
    message: string,
    details?: ErrorDetails,
    cause?: Error,
  ): ToolExecutionError {
    return new ToolExecutionError(
      ErrorCode.TOOL_REGISTRATION_FAILED,
      `工具 "${toolName}" 注册失败: ${message}`,
      { ...details, toolName },
      cause,
    );
  }

  /**
   * 创建工具名称重复错误
   */
  static duplicateName(
    toolName: string,
    owner?: string,
    details?: ErrorDetails,
  ): ToolExecutionError {
    return new ToolExecutionError(ErrorCode.TOOL_DUPLICATE_NAME, `工具 "${toolName}" 已存在`, {
      ...details,
      toolName,
      owner,
    });
  }

  /**
   * 创建工具权限拒绝错误
   */
  static permissionDenied(
    toolName: string,
    roleId: string,
    details?: ErrorDetails,
  ): ToolExecutionError {
    return new ToolExecutionError(
      ErrorCode.TOOL_PERMISSION_DENIED,
      `角色 "${roleId}" 无权使用工具 "${toolName}"`,
      { ...details, toolName, roleId },
    );
  }

  /**
   * 创建工具参数无效错误
   */
  static invalidParams(
    toolName: string,
    message: string,
    params?: unknown,
    details?: ErrorDetails,
  ): ToolExecutionError {
    return new ToolExecutionError(
      ErrorCode.TOOL_INVALID_PARAMS,
      `工具 "${toolName}" 参数无效: ${message}`,
      { ...details, toolName, params },
    );
  }

  /**
   * 创建工具超时错误
   */
  static timeout(toolName: string, timeoutMs: number, details?: ErrorDetails): ToolExecutionError {
    return new ToolExecutionError(
      ErrorCode.TOOL_TIMEOUT,
      `工具 "${toolName}" 执行超时 (${timeoutMs}ms)`,
      { ...details, toolName, timeoutMs },
    );
  }
}
