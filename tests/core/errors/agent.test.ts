/**
 * Agent 错误测试
 */

import { describe, it, expect } from 'vitest';
import { AgentExecutionError, ErrorCode } from '@aesyclaw/core/errors';
import { AgentRunCancelledError } from '@aesyclaw/agent/runner/shared';

describe('AgentExecutionError', () => {
  describe('构造函数', () => {
    it('应该创建 Agent 错误实例', () => {
      const error = new AgentExecutionError(ErrorCode.AGENT_PROCESSING_FAILED, '处理失败', {
        roleId: 'test-role',
        sessionKey: 'test-session',
      });

      expect(error).toBeInstanceOf(AgentExecutionError);
      expect(error.code).toBe(ErrorCode.AGENT_PROCESSING_FAILED);
      expect(error.message).toBe('处理失败');
      expect(error.roleId).toBe('test-role');
      expect(error.sessionKey).toBe('test-session');
    });
  });

  describe('initializationFailed', () => {
    it('应该创建初始化失败错误', () => {
      const error = AgentExecutionError.initializationFailed('初始化失败');

      expect(error.code).toBe(ErrorCode.AGENT_INITIALIZATION_FAILED);
      expect(error.message).toBe('初始化失败');
    });
  });

  describe('processingFailed', () => {
    it('应该创建处理失败错误', () => {
      const error = AgentExecutionError.processingFailed('处理失败', {
        roleId: 'test-role',
      });

      expect(error.code).toBe(ErrorCode.AGENT_PROCESSING_FAILED);
      expect(error.message).toBe('处理失败');
      expect(error.roleId).toBe('test-role');
    });
  });

  describe('llmCallFailed', () => {
    it('应该创建 LLM 调用失败错误', () => {
      const cause = new Error('网络错误');
      const error = AgentExecutionError.llmCallFailed('LLM 调用失败', undefined, cause);

      expect(error.code).toBe(ErrorCode.AGENT_LLM_CALL_FAILED);
      expect(error.message).toBe('LLM 调用失败');
      expect(error.cause).toBe(cause);
    });
  });

  describe('roleNotFound', () => {
    it('应该创建角色未找到错误', () => {
      const error = AgentExecutionError.roleNotFound('test-role');

      expect(error.code).toBe(ErrorCode.AGENT_ROLE_NOT_FOUND);
      expect(error.message).toContain('test-role');
      expect(error.roleId).toBe('test-role');
    });
  });

  describe('modelNotFound', () => {
    it('应该创建模型未找到错误', () => {
      const error = AgentExecutionError.modelNotFound('gpt-4');

      expect(error.code).toBe(ErrorCode.AGENT_MODEL_NOT_FOUND);
      expect(error.message).toContain('gpt-4');
      expect(error.modelId).toBe('gpt-4');
    });
  });

  describe('promptBuildFailed', () => {
    it('应该创建 Prompt 构建失败错误', () => {
      const error = AgentExecutionError.promptBuildFailed('构建失败');

      expect(error.code).toBe(ErrorCode.AGENT_PROMPT_BUILD_FAILED);
      expect(error.message).toBe('构建失败');
    });
  });

  describe('cancelled', () => {
    it('应该创建取消错误', () => {
      const error = AgentExecutionError.cancelled('用户取消');

      expect(error.code).toBe(ErrorCode.AGENT_CANCELLED);
      expect(error.message).toBe('用户取消');
    });

    it('应该让运行取消错误接入统一错误基类', () => {
      const error = new AgentRunCancelledError();

      expect(error).toBeInstanceOf(AgentExecutionError);
      expect(error.name).toBe('AgentRunCancelledError');
      expect(error.code).toBe(ErrorCode.AGENT_CANCELLED);
      expect(error.message).toBe('Agent 处理已中止');
    });
  });
});
