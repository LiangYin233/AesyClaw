import { formatLocalTimestamp } from '../../../platform/observability/logging.js';
import { logging, tokenUsage, type LogLevel } from '../../../platform/observability/index.js';
import type { Config } from '../../../types.js';

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
    } catch {
      // 配置持久化失败时，仍保留内存中的实时日志等级。
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
