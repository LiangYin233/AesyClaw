/**
 * 错误工具函数测试
 */

import { describe, it, expect } from 'vitest';
import { errorMessage, AesyClawError, ErrorCode } from '@aesyclaw/core/errors';

describe('errorMessage', () => {
  it('应该从 Error 提取消息', () => {
    expect(errorMessage(new Error('test error'))).toBe('test error');
  });

  it('应该从 AesyClawError 提取消息', () => {
    const error = new AesyClawError(ErrorCode.INTERNAL, '测试错误');
    expect(errorMessage(error)).toBe('测试错误');
  });

  it('应该转换非 Error 值', () => {
    expect(errorMessage('raw string')).toBe('raw string');
    expect(errorMessage(42)).toBe('42');
    expect(errorMessage(null)).toBe('null');
    expect(errorMessage(undefined)).toBe('undefined');
    expect(errorMessage({ key: 'val' })).toBe('[object Object]');
  });
});
