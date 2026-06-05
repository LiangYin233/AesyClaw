/**
 * 错误工厂函数
 *
 * 提供便捷的错误创建方法，统一错误实例化逻辑
 */

import { AgentExecutionError } from './agent';
import { ToolExecutionError } from './tool';
import { ConfigurationError } from './config';

/**
 * 错误工厂类
 *
 * 提供静态方法创建各种类型的错误
 */
export class ErrorFactory {
  // ─── Agent 错误工厂方法 ───────────────────────────────────────

  static agent = {
    llmCallFailed: AgentExecutionError.llmCallFailed,
    roleNotFound: AgentExecutionError.roleNotFound,
    modelNotFound: AgentExecutionError.modelNotFound,
  };

  // ─── Tool 错误工厂方法 ────────────────────────────────────────

  static tool = {
    duplicateName: ToolExecutionError.duplicateName,
  };

  // ─── Config 错误工厂方法 ──────────────────────────────────────

  static config = {
    invalid: ConfigurationError.invalid,
    missing: ConfigurationError.missing,
    parseFailed: ConfigurationError.parseFailed,
    validationFailed: ConfigurationError.validationFailed,
  };
}
