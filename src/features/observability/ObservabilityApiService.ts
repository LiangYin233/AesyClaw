import { formatLocalTimestamp } from '../../platform/observability/logging.js';
import { logger, type LogLevel } from '../../platform/observability/index.js';
import { ObservabilityRepository } from './ObservabilityRepository.js';

const log = logger.child('ObservabilityAPI');

export class ObservabilityApiService {
  constructor(private readonly observabilityRepository: ObservabilityRepository) {}

  getLoggingConfig(): ReturnType<ObservabilityRepository['getLoggingConfig']> {
    return this.observabilityRepository.getLoggingConfig();
  }

  getLoggingEntries(query: { limit: number; level?: LogLevel }): {
    entries: ReturnType<ObservabilityRepository['getLoggingEntries']>;
    total: number;
    bufferSize: number;
    level: LogLevel;
  } {
    return {
      entries: this.observabilityRepository.getLoggingEntries(query),
      total: this.observabilityRepository.getLoggingBufferSize(),
      bufferSize: this.observabilityRepository.getLoggingConfig().bufferSize,
      level: this.observabilityRepository.getCurrentLoggingLevel()
    };
  }

  async updateLoggingLevel(level: LogLevel): Promise<{ success: true; level: LogLevel }> {
    this.observabilityRepository.setLoggingLevel(level);

    try {
      await this.observabilityRepository.updateConfig((config) => {
        config.observability.level = level;
      });
      log.info('日志级别已更新', { level });
    } catch (saveError) {
      log.warn('日志级别已在内存更新，但写入配置失败', {
        level,
        error: saveError instanceof Error ? saveError.message : String(saveError)
      });
    }

    return { success: true, level: this.observabilityRepository.getCurrentLoggingLevel() };
  }

  getUsage(): Record<string, unknown> {
    const stats = this.observabilityRepository.getUsageStats();
    return {
      ...stats,
      lastUpdated: formatLocalTimestamp(stats.lastUpdated),
      daily: stats.daily.map((item) => ({
        ...item,
        lastUpdated: item.lastUpdated ? formatLocalTimestamp(item.lastUpdated) : undefined
      }))
    };
  }

  resetUsage(): { success: true } {
    this.observabilityRepository.resetUsage();
    return { success: true };
  }
}
