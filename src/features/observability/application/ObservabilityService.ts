import { formatLocalTimestamp } from '../../../platform/observability/logging.js';
import { logger, logging, tokenUsage, type LogLevel } from '../../../platform/observability/index.js';
import type { Config } from '../../../types.js';

const log = logger.child('ObservabilityAPI');

export class ObservabilityService {
  constructor(
    private readonly updateConfig: (mutator: (config: Config) => void | Config | Promise<void | Config>) => Promise<Config>
  ) {}

  getLoggingConfig(): ReturnType<typeof logging.getConfig> {
    return logging.getConfig();
  }

  getLoggingEntries(query: { limit: number; level?: LogLevel }): {
    entries: ReturnType<typeof logging.getEntries>;
    total: number;
    bufferSize: number;
    level: LogLevel;
  } {
    return {
      entries: logging.getEntries(query),
      total: logging.getBufferSize(),
      bufferSize: logging.getConfig().bufferSize,
      level: logging.getLevel()
    };
  }

  async updateLoggingLevel(level: LogLevel): Promise<{ success: true; level: LogLevel }> {
    logging.setLevel(level);

    try {
      await this.updateConfig((config) => {
        config.observability.level = level;
      });
      log.info('日志级别已更新', { level });
    } catch (saveError) {
      log.warn('日志级别已在内存更新，但写入配置失败', {
        level,
        error: saveError instanceof Error ? saveError.message : String(saveError)
      });
    }

    return { success: true, level: logging.getLevel() };
  }

  getUsage(): Record<string, unknown> {
    const stats = tokenUsage.getStats();
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
    tokenUsage.reset();
    return { success: true };
  }
}
