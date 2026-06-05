/**
 * Agent 执行相关错误
 */

import { AesyClawError, ErrorCode, type ErrorDetails } from './base';

/**
 * Agent 执行错误
 *
 * 用于 Agent 处理消息、调用 LLM、构建 Prompt 等过程中的错误
 */
export class AgentExecutionError extends AesyClawError {
  /** Agent 角色 ID */
  readonly roleId?: string;

  /** 会话标识 */
  readonly sessionKey?: string;

  /** 模型标识符 */
  readonly modelId?: string;

  constructor(
    code: ErrorCode,
    message: string,
    details?: ErrorDetails & {
      roleId?: string;
      sessionKey?: string;
      modelId?: string;
    },
    cause?: Error,
  ) {
    super(code, message, details, cause);
    this.roleId = details?.roleId;
    this.sessionKey = details?.sessionKey;
    this.modelId = details?.modelId;
  }

  /**
   * 创建 LLM 调用失败错误
   */
  static llmCallFailed(
    message: string,
    details?: ErrorDetails,
    cause?: Error,
  ): AgentExecutionError {
    return new AgentExecutionError(ErrorCode.AGENT_LLM_CALL_FAILED, message, details, cause);
  }

  /**
   * 创建角色未找到错误
   */
  static roleNotFound(roleId: string, details?: ErrorDetails): AgentExecutionError {
    return new AgentExecutionError(ErrorCode.AGENT_ROLE_NOT_FOUND, `角色 "${roleId}" 未找到`, {
      ...details,
      roleId,
    });
  }

  /**
   * 创建模型未找到错误
   */
  static modelNotFound(modelId: string, details?: ErrorDetails): AgentExecutionError {
    return new AgentExecutionError(ErrorCode.AGENT_MODEL_NOT_FOUND, `模型 "${modelId}" 未找到`, {
      ...details,
      modelId,
    });
  }

}
