/**
 * Tool 错误测试
 */

import { describe, it, expect } from 'vitest';
import { ToolExecutionError, ErrorCode } from '@aesyclaw/core/errors';

describe('ToolExecutionError', () => {
  describe('构造函数', () => {
    it('应该创建工具错误实例', () => {
      const error = new ToolExecutionError(ErrorCode.TOOL_EXECUTION_FAILED, '执行失败', {
        toolName: 'test-tool',
        owner: 'plugin:test',
      });

      expect(error).toBeInstanceOf(ToolExecutionError);
      expect(error.code).toBe(ErrorCode.TOOL_EXECUTION_FAILED);
      expect(error.message).toBe('执行失败');
      expect(error.toolName).toBe('test-tool');
      expect(error.owner).toBe('plugin:test');
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
});
