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

export interface MetricsConfig {
  enabled: boolean;
  maxPoints: number;
}

export class MetricsCollector {
  private metrics: Metric[] = [];
  private config: MetricsConfig = {
    enabled: true,
    maxPoints: 10000
  };

  configure(partial: Partial<MetricsConfig>): void {
    this.config = {
      ...this.config,
      ...partial
    };
    if (this.metrics.length > this.config.maxPoints) {
      this.metrics = this.metrics.slice(-this.config.maxPoints);
    }
  }

  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  record(name: string, value: number, unit: Metric['unit'], tags?: Record<string, string>): void {
    if (!this.config.enabled) {
      return;
    }

    this.metrics.push({
      name,
      value,
      unit,
      timestamp: new Date(),
      tags
    });

    if (this.metrics.length > this.config.maxPoints) {
      this.metrics = this.metrics.slice(-this.config.maxPoints);
    }
  }

  timer(name: string, tags?: Record<string, string>): () => void {
    if (!this.config.enabled) {
      return () => {};
    }

    const startedAt = performance.now();
    return () => {
      this.record(name, performance.now() - startedAt, 'ms', tags);
    };
  }

  getStats(name: string, timeWindow?: number): MetricStats | null {
    let filtered = this.metrics.filter((metric) => metric.name === name);
    if (timeWindow) {
      const cutoff = Date.now() - timeWindow;
      filtered = filtered.filter((metric) => metric.timestamp.getTime() >= cutoff);
    }

    if (filtered.length === 0) {
      return null;
    }

    const values = filtered.map((metric) => metric.value).sort((left, right) => left - right);
    const sum = values.reduce((acc, value) => acc + value, 0);

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

  getMetricNames(): string[] {
    return Array.from(new Set(this.metrics.map((metric) => metric.name)));
  }

  export(name?: string, timeWindow?: number): Metric[] {
    let result = this.metrics;
    if (name) {
      result = result.filter((metric) => metric.name === name);
    }
    if (timeWindow) {
      const cutoff = Date.now() - timeWindow;
      result = result.filter((metric) => metric.timestamp.getTime() >= cutoff);
    }
    return [...result];
  }

  clear(name?: string): void {
    this.metrics = name
      ? this.metrics.filter((metric) => metric.name !== name)
      : [];
  }

  getConfig(): MetricsConfig & { currentCount: number } {
    return {
      ...this.config,
      currentCount: this.metrics.length
    };
  }

  private percentile(sortedValues: number[], percentile: number): number {
    const index = Math.ceil(sortedValues.length * percentile) - 1;
    return sortedValues[Math.max(0, index)];
  }
}

export const metrics = new MetricsCollector();
