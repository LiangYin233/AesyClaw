import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CronService, type CronJob } from '../../src/cron/CronService';

// Mock fs to avoid actual file I/O
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue('[]'),
  writeFileSync: vi.fn()
}));

function makeJob(overrides: Partial<CronJob> = {}): CronJob {
  return {
    id: 'test-1',
    name: 'Test Job',
    enabled: true,
    schedule: { kind: 'once' },
    payload: { description: 'test', detail: 'test detail' },
    ...overrides
  };
}

describe('CronService', () => {
  let service: CronService;

  beforeEach(() => {
    service = new CronService('/tmp/test-cron.json');
  });

  describe('computeNextRun', () => {
    it('should set nextRunAtMs for future once schedule', () => {
      const future = new Date(Date.now() + 60_000).toISOString();
      const job = makeJob({ schedule: { kind: 'once', onceAt: future } });
      service.computeNextRun(job);
      expect(job.nextRunAtMs).toBeDefined();
      expect(job.nextRunAtMs).toBeGreaterThan(Date.now() - 1000);
    });

    it('should set nextRunAtMs to undefined for past once schedule', () => {
      const past = new Date(Date.now() - 60_000).toISOString();
      const job = makeJob({ schedule: { kind: 'once', onceAt: past } });
      service.computeNextRun(job);
      expect(job.nextRunAtMs).toBeUndefined();
    });

    it('should set nextRunAtMs to undefined when once has no onceAt', () => {
      const job = makeJob({ schedule: { kind: 'once' } });
      service.computeNextRun(job);
      expect(job.nextRunAtMs).toBeUndefined();
    });

    it('should set nextRunAtMs for interval schedule', () => {
      const job = makeJob({ schedule: { kind: 'interval', intervalMs: 5000 } });
      const before = Date.now();
      service.computeNextRun(job);
      expect(job.nextRunAtMs).toBeGreaterThanOrEqual(before + 5000);
      expect(job.nextRunAtMs).toBeLessThanOrEqual(Date.now() + 5000 + 100);
    });

    it('should set nextRunAtMs to undefined for zero interval', () => {
      const job = makeJob({ schedule: { kind: 'interval', intervalMs: 0 } });
      service.computeNextRun(job);
      expect(job.nextRunAtMs).toBeUndefined();
    });

    it('should set nextRunAtMs to undefined for negative interval', () => {
      const job = makeJob({ schedule: { kind: 'interval', intervalMs: -100 } });
      service.computeNextRun(job);
      expect(job.nextRunAtMs).toBeUndefined();
    });

    it('should set nextRunAtMs for daily schedule', () => {
      const job = makeJob({ schedule: { kind: 'daily', dailyAt: '09:00' } });
      service.computeNextRun(job);
      expect(job.nextRunAtMs).toBeDefined();
      expect(job.nextRunAtMs).toBeGreaterThan(Date.now() - 1000);
    });

    it('should set nextRunAtMs to undefined for invalid daily time', () => {
      const job = makeJob({ schedule: { kind: 'daily', dailyAt: '25:00' } });
      service.computeNextRun(job);
      expect(job.nextRunAtMs).toBeUndefined();
    });

    it('should set nextRunAtMs to undefined for non-numeric daily time', () => {
      const job = makeJob({ schedule: { kind: 'daily', dailyAt: 'abc' } });
      service.computeNextRun(job);
      expect(job.nextRunAtMs).toBeUndefined();
    });

    it('should set nextRunAtMs for valid cron expression', () => {
      const job = makeJob({ schedule: { kind: 'cron', cronExpr: '*/5 * * * *' } });
      service.computeNextRun(job);
      expect(job.nextRunAtMs).toBeDefined();
      expect(job.nextRunAtMs).toBeGreaterThan(Date.now());
    });

    it('should set nextRunAtMs to undefined for invalid cron expression', () => {
      const job = makeJob({ schedule: { kind: 'cron', cronExpr: 'invalid' } });
      service.computeNextRun(job);
      expect(job.nextRunAtMs).toBeUndefined();
    });

    it('should set nextRunAtMs to undefined when cron has no expression', () => {
      const job = makeJob({ schedule: { kind: 'cron' } });
      service.computeNextRun(job);
      expect(job.nextRunAtMs).toBeUndefined();
    });
  });

  describe('addJob / removeJob / getJob / listJobs', () => {
    it('should add and retrieve a job', () => {
      const job = makeJob();
      service.addJob(job);
      expect(service.getJob('test-1')).toBeDefined();
      expect(service.getJob('test-1')?.name).toBe('Test Job');
    });

    it('should remove a job', () => {
      service.addJob(makeJob());
      expect(service.removeJob('test-1')).toBe(true);
      expect(service.getJob('test-1')).toBeUndefined();
    });

    it('should return false when removing non-existent job', () => {
      expect(service.removeJob('nonexistent')).toBe(false);
    });

    it('should list jobs with hidden detail', () => {
      service.addJob(makeJob());
      const jobs = service.listJobs();
      expect(jobs).toHaveLength(1);
      expect(jobs[0].payload.detail).toBe('[隐藏]');
    });
  });

  describe('enableJob', () => {
    it('should enable/disable a job', () => {
      service.addJob(makeJob({ enabled: true }));
      service.enableJob('test-1', false);
      expect(service.getJob('test-1')?.enabled).toBe(false);
      service.enableJob('test-1', true);
      expect(service.getJob('test-1')?.enabled).toBe(true);
    });
  });
});
