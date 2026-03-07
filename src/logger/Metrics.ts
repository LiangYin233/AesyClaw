/**
 * Performance Metrics Collector
 *
 * 收集性能指标，用于监控和分析
 */

export interface Metric {
  name: string;
  value: number;
  unit: 'ms' | 'count' | 'bytes';
  timestamp: Date;
  tags?: Record<string, string>;
}

export interface MetricStats {
  count: number;
  sum: number;
  mean: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
}

export class MetricsCollector {
  private metrics: Metric[] = [];
  private readonly maxMetrics: number;
  private enabled: boolean;

  constructor(maxMetrics = 10000, enabled = true) {
    this.maxMetrics = maxMetrics;
    this.enabled = enabled;
  }

  /**
   * 启用或禁用指标收集
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * 检查是否启用
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * 记录指标
   */
  record(name: string, value: number, unit: Metric['unit'], tags?: Record<string, string>): void {
    if (!this.enabled) return;

    this.metrics.push({
      name,
      value,
      unit,
      timestamp: new Date(),
      tags
    });

    // 限制内存使用，保留最近的指标
    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-this.maxMetrics);
    }
  }

  /**
   * 计时器 - 返回结束函数
   */
  timer(name: string, tags?: Record<string, string>): () => void {
    if (!this.enabled) {
      return () => {}; // 返回空函数，避免性能开销
    }

    const start = performance.now();
    return () => {
      const duration = performance.now() - start;
      this.record(name, duration, 'ms', tags);
    };
  }

  /**
   * 获取指标统计（包含百分位数）
   */
  getStats(name: string, timeWindow?: number): MetricStats | null {
    let filtered = this.metrics.filter(m => m.name === name);

    // 时间窗口过滤（毫秒）
    if (timeWindow) {
      const cutoff = Date.now() - timeWindow;
      filtered = filtered.filter(m => m.timestamp.getTime() >= cutoff);
    }

    if (filtered.length === 0) return null;

    const values = filtered.map(m => m.value).sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);

    return {
      count: values.length,
      sum,
      mean: sum / values.length,
      min: values[0],
      max: values[values.length - 1],
      p50: this.percentile(values, 0.5),
      p95: this.percentile(values, 0.95),
      p99: this.percentile(values, 0.99)
    };
  }

  /**
   * 计算百分位数
   */
  private percentile(sortedValues: number[], p: number): number {
    const index = Math.ceil(sortedValues.length * p) - 1;
    return sortedValues[Math.max(0, index)];
  }

  /**
   * 获取所有指标名称
   */
  getMetricNames(): string[] {
    const names = new Set(this.metrics.map(m => m.name));
    return Array.from(names);
  }

  /**
   * 导出指标（用于外部分析）
   */
  export(name?: string, timeWindow?: number): Metric[] {
    let result = this.metrics;

    if (name) {
      result = result.filter(m => m.name === name);
    }

    if (timeWindow) {
      const cutoff = Date.now() - timeWindow;
      result = result.filter(m => m.timestamp.getTime() >= cutoff);
    }

    return [...result];
  }

  /**
   * 清空指标
   */
  clear(name?: string): void {
    if (name) {
      this.metrics = this.metrics.filter(m => m.name !== name);
    } else {
      this.metrics = [];
    }
  }

  /**
   * 获取内存使用情况
   */
  getMemoryUsage(): { count: number; maxCount: number; usage: string } {
    return {
      count: this.metrics.length,
      maxCount: this.maxMetrics,
      usage: `${((this.metrics.length / this.maxMetrics) * 100).toFixed(1)}%`
    };
  }

  /**
   * 获取配置
   */
  getConfig(): { enabled: boolean; maxMetrics: number; currentCount: number } {
    return {
      enabled: this.enabled,
      maxMetrics: this.maxMetrics,
      currentCount: this.metrics.length
    };
  }
}

/**
 * 全局指标收集器
 */
export const metrics = new MetricsCollector();
