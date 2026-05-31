/**
 * Tool 错误测试
 */

import { describe, it, expect } from 'vitest';
import { ToolExecutionError, ErrorCode } from '@aesyclaw/core/errors';

describe('ToolExecutionError', () => {
  describe('构造函数', () => {
    it('应该创建工具错误实例', () => {
      const error = new ToolExecutionError(
        ErrorCode.TOOL_EXECUTION_FAILED,
        '执行失败',
        { toolName: 'test-tool', owner: 'plugin:test' },
      );

      expect(error).toBeInstanceOf(ToolExecutionError);
      expect(error.code).toBe(ErrorCode.TOOL_EXECUTION_FAILED);
      expect(error.message).toBe('执行失败');
      expect(error.toolName).toBe('test-tool');
      expect(error.owner).toBe('plugin:test');
    });
  });

  describe('notFound', () => {
    it('应该创建工具未找到错误', () => {
      const error = ToolExecutionError.notFound('test-tool');

      expect(error.code).toBe(ErrorCode.TOOL_NOT_FOUND);
      expect(error.message).toContain('test-tool');
      expect(error.toolName).toBe('test-tool');
    });
  });

  describe('executionFailed', () => {
    it('应该创建执行失败错误', () => {
      const cause = new Error('内部错误');
      const error = ToolExecutionError.executionFailed('test-tool', '执行失败', undefined, cause);

      expect(error.code).toBe(ErrorCode.TOOL_EXECUTION_FAILED);
      expect(error.message).toContain('test-tool');
      expect(error.message).toContain('执行失败');
      expect(error.cause).toBe(cause);
    });
  });

  describe('registrationFailed', () => {
    it('应该创建注册失败错误', () => {
      const error = ToolExecutionError.registrationFailed('test-tool', '注册失败');

      expect(error.code).toBe(ErrorCode.TOOL_REGISTRATION_FAILED);
      expect(error.message).toContain('test-tool');
      expect(error.message).toContain('注册失败');
    });
  });

  describe('duplicateName', () => {
    it('应该创建名称重复错误', () => {
      const error = ToolExecutionError.duplicateName('test-tool', 'plugin:test');

      expect(error.code).toBe(ErrorCode.TOOL_DUPLICATE_NAME);
      expect(error.message).toContain('test-tool');
      expect(error.toolName).toBe('test-tool');
      expect(error.owner).toBe('plugin:test');
    });
  });

  describe('permissionDenied', () => {
    it('应该创建权限拒绝错误', () => {
      const error = ToolExecutionError.permissionDenied('test-tool', 'test-role');

      expect(error.code).toBe(ErrorCode.TOOL_PERMISSION_DENIED);
      expect(error.message).toContain('test-tool');
      expect(error.message).toContain('test-role');
      expect(error.toolName).toBe('test-tool');
    });
  });

  describe('invalidParams', () => {
    it('应该创建参数无效错误', () => {
      const params = { key: 'value' };
      const error = ToolExecutionError.invalidParams('test-tool', '参数错误', params);

      expect(error.code).toBe(ErrorCode.TOOL_INVALID_PARAMS);
      expect(error.message).toContain('test-tool');
      expect(error.message).toContain('参数错误');
      expect(error.params).toEqual(params);
    });
  });

  describe('timeout', () => {
    it('应该创建超时错误', () => {
      const error = ToolExecutionError.timeout('test-tool', 5000);

      expect(error.code).toBe(ErrorCode.TOOL_TIMEOUT);
      expect(error.message).toContain('test-tool');
      expect(error.message).toContain('5000');
      expect(error.toolName).toBe('test-tool');
    });
  });
});
