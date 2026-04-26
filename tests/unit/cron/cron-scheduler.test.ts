import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CronScheduler, computeNextRun } from '../../../src/cron/cron-scheduler';
import type { CronJobRecord } from '../../../src/core/types';

function makeJob(overrides: Partial<CronJobRecord> = {}): CronJobRecord {
  return {
    id: 'job-1',
    scheduleType: 'once',
    scheduleValue: new Date(Date.now() + 10000).toISOString(),
    prompt: 'test prompt',
    sessionKey: JSON.stringify({ channel: 'test', type: 'private', chatId: '123' }),
    nextRun: new Date(Date.now() + 10000).toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('computeNextRun', () => {
  describe('once schedule', () => {
    it('should return the parsed date if it is in the future', () => {
      const future = new Date(Date.now() + 3600_000).toISOString();
      const result = computeNextRun('once', future);
      expect(result).not.toBeNull();
      expect(result!.toISOString()).toBe(future);
    });

    it('should return null if the date is in the past', () => {
      const past = new Date(Date.now() - 3600_000).toISOString();
      const result = computeNextRun('once', past);
      expect(result).toBeNull();
    });

    it('should return null for an invalid date string', () => {
      const result = computeNextRun('once', 'not-a-date');
      expect(result).toBeNull();
    });
  });

  describe('daily schedule', () => {
    it('should compute the next daily run at a given HH:MM', () => {
      const now = new Date(2026, 3, 26, 10, 0, 0);
      const result = computeNextRun('daily', '08:00', now);
      expect(result).not.toBeNull();
      expect(result!.getHours()).toBe(8);
      expect(result!.getMinutes()).toBe(0);
      // Should be tomorrow since 08:00 is before 10:00
      expect(result!.getDate()).toBe(27);
    });

    it('should compute today if the time has not passed yet', () => {
      const now = new Date(2026, 3, 26, 10, 0, 0);
      const result = computeNextRun('daily', '14:00', now);
      expect(result).not.toBeNull();
      expect(result!.getHours()).toBe(14);
      expect(result!.getMinutes()).toBe(0);
      expect(result!.getDate()).toBe(26);
    });

    it('should return null for invalid daily format', () => {
      const result = computeNextRun('daily', 'abc');
      expect(result).toBeNull();
    });

    it('should return null for out-of-range hours', () => {
      const result = computeNextRun('daily', '25:00');
      expect(result).toBeNull();
    });

    it('should return null for out-of-range minutes', () => {
      const result = computeNextRun('daily', '12:60');
      expect(result).toBeNull();
    });

    it('should handle leading zeros', () => {
      const now = new Date(2026, 3, 26, 10, 0, 0);
      const result = computeNextRun('daily', '09:05', now);
      expect(result).not.toBeNull();
      expect(result!.getHours()).toBe(9);
      expect(result!.getMinutes()).toBe(5);
      expect(result!.getDate()).toBe(27);
    });
  });

  describe('interval schedule', () => {
    it('should compute next run with minutes unit', () => {
      const now = new Date('2026-04-26T10:00:00Z');
      const result = computeNextRun('interval', '30m', now);
      expect(result).not.toBeNull();
      expect(result!.getTime()).toBe(now.getTime() + 30 * 60 * 1000);
    });

    it('should compute next run with hours unit', () => {
      const now = new Date('2026-04-26T10:00:00Z');
      const result = computeNextRun('interval', '2h', now);
      expect(result).not.toBeNull();
      expect(result!.getTime()).toBe(now.getTime() + 2 * 60 * 60 * 1000);
    });

    it('should compute next run with days unit', () => {
      const now = new Date('2026-04-26T10:00:00Z');
      const result = computeNextRun('interval', '1d', now);
      expect(result).not.toBeNull();
      expect(result!.getTime()).toBe(now.getTime() + 24 * 60 * 60 * 1000);
    });

    it('should default to minutes without a unit suffix', () => {
      const now = new Date('2026-04-26T10:00:00Z');
      const result = computeNextRun('interval', '5', now);
      expect(result).not.toBeNull();
      expect(result!.getTime()).toBe(now.getTime() + 5 * 60 * 1000);
    });

    it('should return null for zero interval', () => {
      const result = computeNextRun('interval', '0');
      expect(result).toBeNull();
    });

    it('should return null for negative interval', () => {
      const result = computeNextRun('interval', '-5m');
      expect(result).toBeNull();
    });

    it('should return null for invalid interval format', () => {
      const result = computeNextRun('interval', 'abc');
      expect(result).toBeNull();
    });

    it('should handle case-insensitive units', () => {
      const now = new Date('2026-04-26T10:00:00Z');
      const result = computeNextRun('interval', '10H', now);
      expect(result).not.toBeNull();
      expect(result!.getTime()).toBe(now.getTime() + 10 * 60 * 60 * 1000);
    });
  });

  describe('unknown schedule type', () => {
    it('should return null', () => {
      const result = computeNextRun('unknown', 'anything');
      expect(result).toBeNull();
    });
  });
});

describe('CronScheduler', () => {
  let scheduler: CronScheduler;

  beforeEach(() => {
    vi.useFakeTimers();
    scheduler = new CronScheduler();
  });

  afterEach(() => {
    scheduler.clearAll();
    vi.useRealTimers();
  });

  describe('schedule', () => {
    it('should schedule a job and call the callback when the timer fires', () => {
      const job = makeJob();
      const callback = vi.fn();

      scheduler.schedule(job, callback);
      expect(scheduler.count()).toBe(1);

      vi.advanceTimersByTime(10_000);
      expect(callback).toHaveBeenCalledWith(job);
      expect(scheduler.count()).toBe(0);
    });

    it('should cancel a previously scheduled job with the same id', () => {
      const job = makeJob();
      const firstCallback = vi.fn();
      const secondCallback = vi.fn();

      scheduler.schedule(job, firstCallback);
      scheduler.schedule(job, secondCallback);
      expect(scheduler.count()).toBe(1);

      vi.advanceTimersByTime(10_000);
      expect(firstCallback).not.toHaveBeenCalled();
      expect(secondCallback).toHaveBeenCalledWith(job);
    });

    it('should skip scheduling if nextRun is null', () => {
      const job = makeJob({ nextRun: null });
      const callback = vi.fn();

      scheduler.schedule(job, callback);
      expect(scheduler.count()).toBe(0);
      expect(callback).not.toHaveBeenCalled();
    });

    it('should skip scheduling if nextRun is an invalid date', () => {
      const job = makeJob({ nextRun: 'not-a-date' });
      const callback = vi.fn();

      scheduler.schedule(job, callback);
      expect(scheduler.count()).toBe(0);
      expect(callback).not.toHaveBeenCalled();
    });

    it('should not fire callback before the delay', () => {
      const job = makeJob();
      const callback = vi.fn();

      scheduler.schedule(job, callback);
      vi.advanceTimersByTime(5_000);
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('should cancel a scheduled job', () => {
      const job = makeJob();
      const callback = vi.fn();

      scheduler.schedule(job, callback);
      expect(scheduler.count()).toBe(1);
      scheduler.cancel(job.id);
      expect(scheduler.count()).toBe(0);

      vi.advanceTimersByTime(20_000);
      expect(callback).not.toHaveBeenCalled();
    });

    it('should be a no-op for an unknown job id', () => {
      const callback = vi.fn();
      scheduler.cancel('nonexistent');
      expect(scheduler.count()).toBe(0);
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('clearAll', () => {
    it('should cancel all scheduled jobs', () => {
      const jobs = [makeJob({ id: 'job-1' }), makeJob({ id: 'job-2' }), makeJob({ id: 'job-3' })];
      const callback = vi.fn();

      for (const job of jobs) {
        scheduler.schedule(job, callback);
      }
      expect(scheduler.count()).toBe(3);

      scheduler.clearAll();
      expect(scheduler.count()).toBe(0);

      vi.advanceTimersByTime(20_000);
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('count', () => {
    it('should return 0 with no scheduled jobs', () => {
      expect(scheduler.count()).toBe(0);
    });

    it('should return the number of scheduled jobs', () => {
      scheduler.schedule(makeJob({ id: 'a' }), vi.fn());
      scheduler.schedule(makeJob({ id: 'b' }), vi.fn());
      expect(scheduler.count()).toBe(2);
    });
  });
});
