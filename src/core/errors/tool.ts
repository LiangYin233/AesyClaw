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

}
