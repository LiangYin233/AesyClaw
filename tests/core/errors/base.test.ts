/**
 * 基础错误类测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AesyClawError, ErrorCode } from '@aesyclaw/core/errors';

describe('AesyClawError', () => {
  describe('构造函数', () => {
    it('应该创建基础错误实例', () => {
      const error = new AesyClawError(ErrorCode.UNKNOWN, '测试错误');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AesyClawError);
      expect(error.name).toBe('AesyClawError');
      expect(error.code).toBe(ErrorCode.UNKNOWN);
      expect(error.message).toBe('测试错误');
      expect(error.timestamp).toBeInstanceOf(Date);
    });

    it('应该包含详细信息', () => {
      const details = { userId: '123', action: 'test' };
      const error = new AesyClawError(ErrorCode.INTERNAL, '测试错误', details);

      expect(error.details).toEqual(details);
    });

    it('应该包含原因链', () => {
      const cause = new Error('原始错误');
      const error = new AesyClawError(ErrorCode.INTERNAL, '测试错误', undefined, cause);

      expect(error.cause).toBe(cause);
    });

    it('应该捕获堆栈跟踪', () => {
      const error = new AesyClawError(ErrorCode.UNKNOWN, '测试错误');

      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('AesyClawError');
    });
  });

  describe('toJSON', () => {
    it('应该转换为 JSON 格式', () => {
      const details = { key: 'value' };
      const cause = new Error('原始错误');
      const error = new AesyClawError(ErrorCode.INTERNAL, '测试错误', details, cause);

      const json = error.toJSON();

      expect(json.name).toBe('AesyClawError');
      expect(json.code).toBe(ErrorCode.INTERNAL);
      expect(json.message).toBe('测试错误');
      expect(json.details).toEqual(details);
      expect(json.timestamp).toBeDefined();
      expect(json.cause).toBeDefined();
      expect(json.cause).toHaveProperty('message', '原始错误');
      expect(json.stack).toBeDefined();
    });

    it('应该处理没有原因的情况', () => {
      const error = new AesyClawError(ErrorCode.UNKNOWN, '测试错误');
      const json = error.toJSON();

      expect(json.cause).toBeUndefined();
    });
  });

  describe('toString', () => {
    it('应该生成用户友好的字符串', () => {
      const error = new AesyClawError(ErrorCode.INTERNAL, '测试错误');
      const str = error.toString();

      expect(str).toContain('AesyClawError');
      expect(str).toContain(ErrorCode.INTERNAL);
      expect(str).toContain('测试错误');
    });

    it('应该包含详细信息', () => {
      const details = { key: 'value' };
      const error = new AesyClawError(ErrorCode.INTERNAL, '测试错误', details);
      const str = error.toString();

      expect(str).toContain('详细信息');
      expect(str).toContain('key');
      expect(str).toContain('value');
    });

    it('应该包含原因', () => {
      const cause = new Error('原始错误');
      const error = new AesyClawError(ErrorCode.INTERNAL, '测试错误', undefined, cause);
      const str = error.toString();

      expect(str).toContain('原因');
      expect(str).toContain('原始错误');
    });
  });

  describe('isAesyClawError', () => {
    it('应该识别 AesyClawError 实例', () => {
      const error = new AesyClawError(ErrorCode.UNKNOWN, '测试错误');

      expect(AesyClawError.isAesyClawError(error)).toBe(true);
    });

    it('应该拒绝普通 Error', () => {
      const error = new Error('测试错误');

      expect(AesyClawError.isAesyClawError(error)).toBe(false);
    });

    it('应该拒绝非错误对象', () => {
      expect(AesyClawError.isAesyClawError('string')).toBe(false);
      expect(AesyClawError.isAesyClawError(123)).toBe(false);
      expect(AesyClawError.isAesyClawError(null)).toBe(false);
      expect(AesyClawError.isAesyClawError(undefined)).toBe(false);
    });
  });

  describe('from', () => {
    it('应该保留 AesyClawError 实例', () => {
      const original = new AesyClawError(ErrorCode.INTERNAL, '测试错误');
      const converted = AesyClawError.from(original);

      expect(converted).toBe(original);
    });

    it('应该转换普通 Error', () => {
      const original = new Error('测试错误');
      const converted = AesyClawError.from(original);

      expect(converted).toBeInstanceOf(AesyClawError);
      expect(converted.code).toBe(ErrorCode.UNKNOWN);
      expect(converted.message).toBe('测试错误');
      expect(converted.cause).toBe(original);
    });

    it('应该使用自定义错误码', () => {
      const original = new Error('测试错误');
      const converted = AesyClawError.from(original, ErrorCode.INTERNAL);

      expect(converted.code).toBe(ErrorCode.INTERNAL);
    });

    it('应该包含详细信息', () => {
      const original = new Error('测试错误');
      const details = { key: 'value' };
      const converted = AesyClawError.from(original, ErrorCode.INTERNAL, details);

      expect(converted.details).toEqual(details);
    });

    it('应该转换非 Error 对象', () => {
      const converted = AesyClawError.from('字符串错误');

      expect(converted).toBeInstanceOf(AesyClawError);
      expect(converted.message).toBe('字符串错误');
    });
  });
});
