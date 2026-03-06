import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsCollector } from '../../src/logger/Metrics';

describe('MetricsCollector', () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    collector = new MetricsCollector(100, true);
  });

  describe('enabled / disabled', () => {
    it('should be enabled by default', () => {
      expect(collector.isEnabled()).toBe(true);
    });

    it('should toggle enabled state', () => {
      collector.setEnabled(false);
      expect(collector.isEnabled()).toBe(false);
      collector.setEnabled(true);
      expect(collector.isEnabled()).toBe(true);
    });

    it('should not record when disabled', () => {
      collector.setEnabled(false);
      collector.record('test', 100, 'ms');
      expect(collector.getMetricNames()).toHaveLength(0);
    });

    it('should return noop timer when disabled', () => {
      collector.setEnabled(false);
      const end = collector.timer('test');
      end(); // should not throw
      expect(collector.getMetricNames()).toHaveLength(0);
    });
  });

  describe('record', () => {
    it('should store metrics', () => {
      collector.record('api.latency', 100, 'ms');
      collector.record('api.latency', 200, 'ms');
      expect(collector.getMetricNames()).toContain('api.latency');
    });

    it('should trim to maxMetrics', () => {
      const small = new MetricsCollector(5, true);
      for (let i = 0; i < 10; i++) {
        small.record('test', i, 'count');
      }
      const stats = small.getStats('test');
      expect(stats!.count).toBeLessThanOrEqual(5);
    });

    it('should support tags', () => {
      collector.record('req', 50, 'ms', { endpoint: '/api' });
      const exported = collector.export('req');
      expect(exported[0].tags).toEqual({ endpoint: '/api' });
    });
  });

  describe('timer', () => {
    it('should record elapsed time', async () => {
      const end = collector.timer('op');
      await new Promise(r => setTimeout(r, 20));
      end();
      const stats = collector.getStats('op');
      expect(stats).not.toBeNull();
      expect(stats!.count).toBe(1);
      expect(stats!.avg).toBeGreaterThanOrEqual(10); // at least some ms
    });
  });

  describe('getStats', () => {
    it('should return null for unknown metric', () => {
      expect(collector.getStats('nonexistent')).toBeNull();
    });

    it('should compute correct statistics', () => {
      const values = [10, 20, 30, 40, 50];
      for (const v of values) {
        collector.record('test', v, 'ms');
      }
      const stats = collector.getStats('test')!;
      expect(stats.count).toBe(5);
      expect(stats.avg).toBe(30);
      expect(stats.min).toBe(10);
      expect(stats.max).toBe(50);
      expect(stats.p50).toBe(30);
    });

    it('should handle single value', () => {
      collector.record('single', 42, 'count');
      const stats = collector.getStats('single')!;
      expect(stats.count).toBe(1);
      expect(stats.avg).toBe(42);
      expect(stats.min).toBe(42);
      expect(stats.max).toBe(42);
      expect(stats.p50).toBe(42);
    });
  });

  describe('export', () => {
    it('should export all metrics', () => {
      collector.record('a', 1, 'count');
      collector.record('b', 2, 'ms');
      const all = collector.export();
      expect(all).toHaveLength(2);
    });

    it('should filter by name', () => {
      collector.record('a', 1, 'count');
      collector.record('b', 2, 'ms');
      expect(collector.export('a')).toHaveLength(1);
    });

    it('should return a copy (not reference)', () => {
      collector.record('a', 1, 'count');
      const exported = collector.export();
      exported.pop();
      expect(collector.export()).toHaveLength(1);
    });
  });

  describe('clear', () => {
    it('should clear all metrics', () => {
      collector.record('a', 1, 'count');
      collector.record('b', 2, 'ms');
      collector.clear();
      expect(collector.getMetricNames()).toHaveLength(0);
    });

    it('should clear only named metric', () => {
      collector.record('a', 1, 'count');
      collector.record('b', 2, 'ms');
      collector.clear('a');
      expect(collector.getMetricNames()).toEqual(['b']);
    });
  });

  describe('getMemoryUsage', () => {
    it('should return correct shape', () => {
      collector.record('test', 1, 'count');
      const usage = collector.getMemoryUsage();
      expect(usage.count).toBe(1);
      expect(usage.maxCount).toBe(100);
      expect(usage.usage).toBe('1.0%');
    });
  });

  describe('getConfig', () => {
    it('should return current configuration', () => {
      const config = collector.getConfig();
      expect(config.enabled).toBe(true);
      expect(config.maxMetrics).toBe(100);
      expect(config.currentCount).toBe(0);
    });
  });
});
