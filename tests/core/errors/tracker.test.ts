/**
 * 错误追踪器测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ErrorTracker, AesyClawError, ErrorCode } from '@aesyclaw/core/errors';

describe('ErrorTracker', () => {
  let tracker: ErrorTracker;

  beforeEach(() => {
    ErrorTracker.resetInstance();
    tracker = ErrorTracker.getInstance();
  });

  afterEach(() => {
    ErrorTracker.resetInstance();
  });

  describe('单例模式', () => {
    it('应该返回相同的实例', () => {
      const instance1 = ErrorTracker.getInstance();
      const instance2 = ErrorTracker.getInstance();

      expect(instance1).toBe(instance2);
    });

    it('应该在重置后创建新实例', () => {
      const instance1 = ErrorTracker.getInstance();
      ErrorTracker.resetInstance();
      const instance2 = ErrorTracker.getInstance();

      expect(instance1).not.toBe(instance2);
    });
  });

  describe('track', () => {
    it('应该追踪错误', () => {
      const error = new AesyClawError(ErrorCode.UNKNOWN, '测试错误');
      tracker.track(error);

      const records = tracker.getRecords();
      expect(records).toHaveLength(1);
      expect(records[0].error).toBe(error);
    });

    it('应该包含上下文信息', () => {
      const error = new AesyClawError(ErrorCode.UNKNOWN, '测试错误');
      const context = { userId: '123', action: 'test' };
      tracker.track(error, context);

      const records = tracker.getRecords();
      expect(records[0].context).toEqual(context);
    });

    it('应该限制记录数量', () => {
      ErrorTracker.resetInstance();
      const smallTracker = ErrorTracker.getInstance({ maxRecords: 5 });

      for (let i = 0; i < 10; i++) {
        const error = new AesyClawError(ErrorCode.UNKNOWN, `错误 ${i}`);
        smallTracker.track(error);
      }

      const records = smallTracker.getRecords();
      expect(records).toHaveLength(5);
      expect(records[0].error.message).toBe('错误 5');
    });

    it('应该在禁用时不追踪', () => {
      tracker.disable();
      const error = new AesyClawError(ErrorCode.UNKNOWN, '测试错误');
      tracker.track(error);

      const records = tracker.getRecords();
      expect(records).toHaveLength(0);
    });

    it('应该调用错误回调', () => {
      let callbackCalled = false;
      ErrorTracker.resetInstance();
      const callbackTracker = ErrorTracker.getInstance({
        onError: () => {
          callbackCalled = true;
        },
      });

      const error = new AesyClawError(ErrorCode.UNKNOWN, '测试错误');
      callbackTracker.track(error);

      expect(callbackCalled).toBe(true);
    });
  });

  describe('getRecords', () => {
    it('应该返回所有记录', () => {
      const error1 = new AesyClawError(ErrorCode.UNKNOWN, '错误 1');
      const error2 = new AesyClawError(ErrorCode.INTERNAL, '错误 2');

      tracker.track(error1);
      tracker.track(error2);

      const records = tracker.getRecords();
      expect(records).toHaveLength(2);
    });

    it('应该返回副本', () => {
      const error = new AesyClawError(ErrorCode.UNKNOWN, '测试错误');
      tracker.track(error);

      const records1 = tracker.getRecords();
      const records2 = tracker.getRecords();

      expect(records1).not.toBe(records2);
      expect(records1).toEqual(records2);
    });
  });

  describe('getRecentRecords', () => {
    it('应该返回最近的 N 条记录', () => {
      for (let i = 0; i < 5; i++) {
        const error = new AesyClawError(ErrorCode.UNKNOWN, `错误 ${i}`);
        tracker.track(error);
      }

      const recent = tracker.getRecentRecords(3);
      expect(recent).toHaveLength(3);
      expect(recent[0].error.message).toBe('错误 2');
      expect(recent[2].error.message).toBe('错误 4');
    });
  });

  describe('getRecordsByCode', () => {
    it('应该按错误码过滤', () => {
      tracker.track(new AesyClawError(ErrorCode.UNKNOWN, '错误 1'));
      tracker.track(new AesyClawError(ErrorCode.INTERNAL, '错误 2'));
      tracker.track(new AesyClawError(ErrorCode.UNKNOWN, '错误 3'));

      const records = tracker.getRecordsByCode(ErrorCode.UNKNOWN);
      expect(records).toHaveLength(2);
      expect(records[0].error.message).toBe('错误 1');
      expect(records[1].error.message).toBe('错误 3');
    });
  });

  describe('getRecordsByType', () => {
    it('应该按错误类型过滤', () => {
      tracker.track(new AesyClawError(ErrorCode.UNKNOWN, '错误 1'));
      tracker.track(new AesyClawError(ErrorCode.INTERNAL, '错误 2'));

      const records = tracker.getRecordsByType('AesyClawError');
      expect(records).toHaveLength(2);
    });
  });

  describe('getRecordsByTimeRange', () => {
    it('应该按时间范围过滤', () => {
      const now = new Date();
      const past = new Date(now.getTime() - 1000);
      const future = new Date(now.getTime() + 1000);

      tracker.track(new AesyClawError(ErrorCode.UNKNOWN, '错误 1'));

      const records = tracker.getRecordsByTimeRange(past, future);
      expect(records).toHaveLength(1);
    });
  });

  describe('getStats', () => {
    it('应该返回统计信息', () => {
      tracker.track(new AesyClawError(ErrorCode.UNKNOWN, '错误 1'));
      tracker.track(new AesyClawError(ErrorCode.INTERNAL, '错误 2'));
      tracker.track(new AesyClawError(ErrorCode.UNKNOWN, '错误 3'));

      const stats = tracker.getStats();
      expect(stats.total).toBe(3);
      expect(stats.byCode.get(ErrorCode.UNKNOWN)).toBe(2);
      expect(stats.byCode.get(ErrorCode.INTERNAL)).toBe(1);
      expect(stats.byType.get('AesyClawError')).toBe(3);
      expect(stats.recent).toHaveLength(3);
    });
  });

  describe('clear', () => {
    it('应该清空所有记录', () => {
      tracker.track(new AesyClawError(ErrorCode.UNKNOWN, '错误 1'));
      tracker.track(new AesyClawError(ErrorCode.INTERNAL, '错误 2'));

      tracker.clear();

      const records = tracker.getRecords();
      expect(records).toHaveLength(0);
    });
  });

  describe('enable/disable', () => {
    it('应该启用追踪', () => {
      tracker.disable();
      expect(tracker.isEnabled()).toBe(false);

      tracker.enable();
      expect(tracker.isEnabled()).toBe(true);
    });
  });

  describe('exportToJSON', () => {
    it('应该导出为 JSON', () => {
      const error = new AesyClawError(ErrorCode.UNKNOWN, '测试错误', { key: 'value' });
      tracker.track(error, { context: 'test' });

      const json = tracker.exportToJSON();
      expect(json).toContain('测试错误');
      expect(json).toContain('ERR_UNKNOWN');
      expect(json).toContain('context');
    });
  });
});
