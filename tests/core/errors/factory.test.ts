/**
 * 错误工厂测试
 */

import { describe, it, expect } from 'vitest';
import {
  ErrorFactory,
  ErrorCode,
  AgentExecutionError,
  ToolExecutionError,
  ConfigurationError,
} from '@aesyclaw/core/errors';

describe('ErrorFactory', () => {
  describe('agent', () => {
    it('应该创建 llmCallFailed 错误', () => {
      const error = ErrorFactory.agent.llmCallFailed('调用失败');

      expect(error).toBeInstanceOf(AgentExecutionError);
      expect(error.code).toBe(ErrorCode.AGENT_LLM_CALL_FAILED);
    });

    it('应该创建 roleNotFound 错误', () => {
      const error = ErrorFactory.agent.roleNotFound('未找到角色');

      expect(error).toBeInstanceOf(AgentExecutionError);
      expect(error.code).toBe(ErrorCode.AGENT_ROLE_NOT_FOUND);
    });

    it('应该创建 modelNotFound 错误', () => {
      const error = ErrorFactory.agent.modelNotFound('test-model');

      expect(error).toBeInstanceOf(AgentExecutionError);
      expect(error.code).toBe(ErrorCode.AGENT_MODEL_NOT_FOUND);
    });
  });

  describe('tool', () => {
    it('应该创建 duplicateName 错误', () => {
      const error = ErrorFactory.tool.duplicateName('test-tool', 'plugin:test');

      expect(error).toBeInstanceOf(ToolExecutionError);
      expect(error.code).toBe(ErrorCode.TOOL_DUPLICATE_NAME);
    });
  });

  describe('config', () => {
    it('应该创建 invalid 错误', () => {
      const error = ErrorFactory.config.invalid('配置无效');

      expect(error).toBeInstanceOf(ConfigurationError);
      expect(error.code).toBe(ErrorCode.CONFIG_INVALID);
    });

    it('应该创建 missing 错误', () => {
      const error = ErrorFactory.config.missing('test-key');

      expect(error).toBeInstanceOf(ConfigurationError);
      expect(error.code).toBe(ErrorCode.CONFIG_MISSING);
    });

    it('应该创建 parseFailed 错误', () => {
      const error = ErrorFactory.config.parseFailed('解析失败');

      expect(error).toBeInstanceOf(ConfigurationError);
      expect(error.code).toBe(ErrorCode.CONFIG_PARSE_FAILED);
    });

    it('应该创建 validationFailed 错误', () => {
      const error = ErrorFactory.config.validationFailed('验证失败');

      expect(error).toBeInstanceOf(ConfigurationError);
      expect(error.code).toBe(ErrorCode.CONFIG_VALIDATION_FAILED);
    });
  });
});
