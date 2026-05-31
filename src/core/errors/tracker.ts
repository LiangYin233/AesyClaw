/**
 * 错误追踪器
 *
 * 收集和统计错误信息，用于监控和调试
 */

import { AesyClawError, ErrorCode } from './base';
import { createScopedLogger } from '@aesyclaw/core/logger';

const logger = createScopedLogger('error-tracker');

/**
 * 错误记录
 */
export type ErrorRecord = {
  /** 错误实例 */
  error: AesyClawError;
  /** 发生时间 */
  timestamp: Date;
  /** 上下文信息 */
  context?: Record<string, unknown>;
};

/**
 * 错误统计
 */
export type ErrorStats = {
  /** 总错误数 */
  total: number;
  /** 按错误码分组的统计 */
  byCode: Map<ErrorCode, number>;
  /** 按错误类型分组的统计 */
  byType: Map<string, number>;
  /** 最近的错误 */
  recent: ErrorRecord[];
};

/**
 * 错误追踪器配置
 */
export type ErrorTrackerConfig = {
  /** 最大保留错误记录数 */
  maxRecords?: number;
  /** 是否启用追踪 */
  enabled?: boolean;
  /** 错误回调函数 */
  onError?: (record: ErrorRecord) => void;
};

/**
 * 错误追踪器
 *
 * 单例模式，全局收集和统计错误信息
 */
export class ErrorTracker {
  private static instance: ErrorTracker | null = null;

  private records: ErrorRecord[] = [];
  private config: Required<ErrorTrackerConfig>;

  private constructor(config: ErrorTrackerConfig = {}) {
    this.config = {
      maxRecords: config.maxRecords ?? 1000,
      enabled: config.enabled ?? true,
      onError: config.onError ?? (() => {}),
    };
  }

  /**
   * 获取单例实例
   */
  static getInstance(config?: ErrorTrackerConfig): ErrorTracker {
    if (!ErrorTracker.instance) {
      ErrorTracker.instance = new ErrorTracker(config);
    }
    return ErrorTracker.instance;
  }

  /**
   * 重置单例实例（主要用于测试）
   */
  static resetInstance(): void {
    ErrorTracker.instance = null;
  }

  /**
   * 追踪错误
   *
   * @param error - 错误实例
   * @param context - 可选的上下文信息
   */
  track(error: AesyClawError, context?: Record<string, unknown>): void {
    if (!this.config.enabled) {
      return;
    }

    const record: ErrorRecord = {
      error,
      timestamp: new Date(),
      context,
    };

    this.records.push(record);

    // 限制记录数量
    if (this.records.length > this.config.maxRecords) {
      this.records.shift();
    }

    // 调用回调
    try {
      this.config.onError(record);
    } catch (callbackError) {
      logger.error('错误追踪回调执行失败', { error: callbackError });
    }

    logger.debug('错误已追踪', {
      code: error.code,
      message: error.message,
      context,
    });
  }

  /**
   * 获取所有错误记录
   */
  getRecords(): ErrorRecord[] {
    return [...this.records];
  }

  /**
   * 获取最近的 N 条错误记录
   */
  getRecentRecords(count: number): ErrorRecord[] {
    return this.records.slice(-count);
  }

  /**
   * 按错误码过滤记录
   */
  getRecordsByCode(code: ErrorCode): ErrorRecord[] {
    return this.records.filter((record) => record.error.code === code);
  }

  /**
   * 按错误类型过滤记录
   */
  getRecordsByType(typeName: string): ErrorRecord[] {
    return this.records.filter((record) => record.error.name === typeName);
  }

  /**
   * 按时间范围过滤记录
   */
  getRecordsByTimeRange(startTime: Date, endTime: Date): ErrorRecord[] {
    return this.records.filter(
      (record) => record.timestamp >= startTime && record.timestamp <= endTime,
    );
  }

  /**
   * 获取错误统计信息
   */
  getStats(): ErrorStats {
    const byCode = new Map<ErrorCode, number>();
    const byType = new Map<string, number>();

    for (const record of this.records) {
      const { error } = record;

      // 按错误码统计
      byCode.set(error.code, (byCode.get(error.code) ?? 0) + 1);

      // 按错误类型统计
      byType.set(error.name, (byType.get(error.name) ?? 0) + 1);
    }

    return {
      total: this.records.length,
      byCode,
      byType,
      recent: this.getRecentRecords(10),
    };
  }

  /**
   * 清空所有错误记录
   */
  clear(): void {
    this.records = [];
    logger.debug('错误记录已清空');
  }

  /**
   * 启用追踪
   */
  enable(): void {
    this.config.enabled = true;
    logger.info('错误追踪已启用');
  }

  /**
   * 禁用追踪
   */
  disable(): void {
    this.config.enabled = false;
    logger.info('错误追踪已禁用');
  }

  /**
   * 检查追踪是否启用
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * 导出错误记录为 JSON
   */
  exportToJSON(): string {
    return JSON.stringify(
      this.records.map((record) => ({
        error: record.error.toJSON(),
        timestamp: record.timestamp.toISOString(),
        context: record.context,
      })),
      null,
      2,
    );
  }
}
