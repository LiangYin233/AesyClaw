/**
 * 错误工厂测试
 */

import { describe, it, expect } from 'vitest';
import {
  ErrorFactory,
  AesyClawError,
  ErrorCode,
  AgentExecutionError,
  ToolExecutionError,
  wrapAsync,
  wrapSync,
} from '@aesyclaw/core/errors';

describe('ErrorFactory', () => {
  describe('fromError', () => {
    it('应该从 Error 创建 AesyClawError', () => {
      const original = new Error('测试错误');
      const error = ErrorFactory.fromError(original);

      expect(error).toBeInstanceOf(AesyClawError);
      expect(error.message).toBe('测试错误');
      expect(error.cause).toBe(original);
    });

    it('应该保留 AesyClawError', () => {
      const original = new AesyClawError(ErrorCode.INTERNAL, '测试错误');
      const error = ErrorFactory.fromError(original);

      expect(error).toBe(original);
    });
  });

  describe('internal', () => {
    it('应该创建内部错误', () => {
      const error = ErrorFactory.internal('内部错误');

      expect(error.code).toBe(ErrorCode.INTERNAL);
      expect(error.message).toBe('内部错误');
    });
  });

  describe('notImplemented', () => {
    it('应该创建未实现错误', () => {
      const error = ErrorFactory.notImplemented('测试功能');

      expect(error.code).toBe(ErrorCode.NOT_IMPLEMENTED);
      expect(error.message).toContain('测试功能');
    });
  });

  describe('agent', () => {
    it('应该创建 Agent 错误', () => {
      const error = ErrorFactory.agent.processingFailed('处理失败');

      expect(error).toBeInstanceOf(AgentExecutionError);
      expect(error.code).toBe(ErrorCode.AGENT_PROCESSING_FAILED);
    });
  });

  describe('tool', () => {
    it('应该创建 Tool 错误', () => {
      const error = ErrorFactory.tool.notFound('test-tool');

      expect(error).toBeInstanceOf(ToolExecutionError);
      expect(error.code).toBe(ErrorCode.TOOL_NOT_FOUND);
    });
  });

  describe('config', () => {
    it('应该创建配置错误', () => {
      const error = ErrorFactory.config.missing('test-key');

      expect(error.code).toBe(ErrorCode.CONFIG_MISSING);
      expect(error.message).toContain('test-key');
    });
  });

  describe('validation', () => {
    it('应该创建验证错误', () => {
      const error = ErrorFactory.validation.typeMismatch('field', 'string', 'number');

      expect(error.code).toBe(ErrorCode.VALIDATION_TYPE_MISMATCH);
      expect(error.message).toContain('field');
    });
  });
});

describe('wrapAsync', () => {
  it('应该包装异步函数', async () => {
    const fn = async () => 'success';
    const wrapped = wrapAsync(fn, ErrorCode.INTERNAL, '执行失败');

    const result = await wrapped();
    expect(result).toBe('success');
  });

  it('应该捕获并转换错误', async () => {
    const fn = async () => {
      throw new Error('原始错误');
    };
    const wrapped = wrapAsync(fn, ErrorCode.INTERNAL, '执行失败');

    await expect(wrapped()).rejects.toThrow(AesyClawError);
    await expect(wrapped()).rejects.toMatchObject({
      code: ErrorCode.INTERNAL,
    });
  });

  it('应该保留 AesyClawError', async () => {
    const originalError = new AesyClawError(ErrorCode.UNKNOWN, '测试错误');
    const fn = async () => {
      throw originalError;
    };
    const wrapped = wrapAsync(fn, ErrorCode.INTERNAL, '执行失败');

    await expect(wrapped()).rejects.toBe(originalError);
  });
});

describe('wrapSync', () => {
  it('应该包装同步函数', () => {
    const fn = () => 'success';
    const wrapped = wrapSync(fn, ErrorCode.INTERNAL, '执行失败');

    const result = wrapped();
    expect(result).toBe('success');
  });

  it('应该捕获并转换错误', () => {
    const fn = () => {
      throw new Error('原始错误');
    };
    const wrapped = wrapSync(fn, ErrorCode.INTERNAL, '执行失败');

    expect(() => wrapped()).toThrow(AesyClawError);
    expect(() => wrapped()).toThrow(
      expect.objectContaining({
        code: ErrorCode.INTERNAL,
      }),
    );
  });

  it('应该保留 AesyClawError', () => {
    const originalError = new AesyClawError(ErrorCode.UNKNOWN, '测试错误');
    const fn = () => {
      throw originalError;
    };
    const wrapped = wrapSync(fn, ErrorCode.INTERNAL, '执行失败');

    expect(() => wrapped()).toThrow(originalError);
  });
});
