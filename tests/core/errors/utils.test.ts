/**
 * 错误工具函数测试
 */

import { describe, it, expect } from 'vitest';
import {
  safeExecute,
  safeExecuteSync,
  executeWithTimeout,
  isErrorCode,
  isErrorType,
  getUserFriendlyMessage,
  errorToToolResult,
  AesyClawError,
  ErrorCode,
  AgentExecutionError,
} from '@aesyclaw/core/errors';

describe('错误工具函数', () => {
  describe('safeExecute', () => {
    it('应该返回成功结果', async () => {
      const result = await safeExecute(async () => 'success');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('success');
      }
    });

    it('应该捕获错误', async () => {
      const result = await safeExecute(async () => {
        throw new Error('测试错误');
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeInstanceOf(AesyClawError);
      }
    });
  });

  describe('safeExecuteSync', () => {
    it('应该返回成功结果', () => {
      const result = safeExecuteSync(() => 'success');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('success');
      }
    });

    it('应该捕获错误', () => {
      const result = safeExecuteSync(() => {
        throw new Error('测试错误');
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeInstanceOf(AesyClawError);
      }
    });
  });

  describe('executeWithTimeout', () => {
    it('应该在超时前返回结果', async () => {
      const fn = async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 'success';
      };

      const result = await executeWithTimeout(fn, 100);
      expect(result).toBe('success');
    });

    it('应该在超时后抛出错误', async () => {
      const fn = async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return 'success';
      };

      await expect(executeWithTimeout(fn, 10)).rejects.toThrow(AesyClawError);
      await expect(executeWithTimeout(fn, 10)).rejects.toMatchObject({
        code: ErrorCode.TOOL_TIMEOUT,
      });
    });
  });

  describe('isErrorCode', () => {
    it('应该识别错误码', () => {
      const error = new AesyClawError(ErrorCode.INTERNAL, '测试错误');

      expect(isErrorCode(error, ErrorCode.INTERNAL)).toBe(true);
      expect(isErrorCode(error, ErrorCode.UNKNOWN)).toBe(false);
    });

    it('应该拒绝非 AesyClawError', () => {
      const error = new Error('测试错误');

      expect(isErrorCode(error, ErrorCode.INTERNAL)).toBe(false);
    });
  });

  describe('isErrorType', () => {
    it('应该识别错误类型', () => {
      const error = new AgentExecutionError(ErrorCode.AGENT_PROCESSING_FAILED, '测试错误');

      expect(isErrorType(error, AgentExecutionError)).toBe(true);
      expect(isErrorType(error, AesyClawError)).toBe(true);
    });

    it('应该拒绝不同类型', () => {
      const error = new AesyClawError(ErrorCode.INTERNAL, '测试错误');

      expect(isErrorType(error, AgentExecutionError)).toBe(false);
    });
  });

  describe('getUserFriendlyMessage', () => {
    it('应该从 AesyClawError 提取消息', () => {
      const error = new AesyClawError(ErrorCode.INTERNAL, '测试错误');
      const message = getUserFriendlyMessage(error);

      expect(message).toBe('测试错误');
    });

    it('应该从 Error 提取消息', () => {
      const error = new Error('测试错误');
      const message = getUserFriendlyMessage(error);

      expect(message).toBe('测试错误');
    });

    it('应该转换非错误对象', () => {
      const message = getUserFriendlyMessage('字符串错误');

      expect(message).toBe('字符串错误');
    });
  });

  describe('errorToToolResult', () => {
    it('应该转换为工具结果格式', () => {
      const error = new AesyClawError(ErrorCode.TOOL_EXECUTION_FAILED, '执行失败', {
        key: 'value',
      });
      const result = errorToToolResult(error);

      expect(result.content).toBe('执行失败');
      expect(result.isError).toBe(true);
      expect(result.details).toBeDefined();
      expect(result.details).toHaveProperty('code', ErrorCode.TOOL_EXECUTION_FAILED);
    });

    it('应该转换普通错误', () => {
      const error = new Error('测试错误');
      const result = errorToToolResult(error);

      expect(result.content).toBe('测试错误');
      expect(result.isError).toBe(true);
    });
  });
});
