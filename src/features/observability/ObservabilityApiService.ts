import { formatLocalTimestamp } from '../../observability/logging.js';
import { logger, type LogLevel } from '../../observability/index.js';
import { ValidationError } from '../../api/errors.js';
import { ObservabilityRepository } from './ObservabilityRepository.js';

const log = logger.child('ObservabilityAPI');
const VALID_LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];

export class ObservabilityApiService {
  constructor(private readonly observabilityRepository: ObservabilityRepository) {}

  getLoggingConfig(): ReturnType<ObservabilityRepository['getLoggingConfig']> {
    return this.observabilityRepository.getLoggingConfig();
  }

  getLoggingEntries(query: { limit?: unknown; level?: unknown }): {
    entries: ReturnType<ObservabilityRepository['getLoggingEntries']>;
    total: number;
    bufferSize: number;
    level: LogLevel;
  } {
    const limit = this.parseLimit(query.limit);
    const level = this.parseOptionalLevel(query.level);

    return {
      entries: this.observabilityRepository.getLoggingEntries({ limit, level }),
      total: this.observabilityRepository.getLoggingBufferSize(),
      bufferSize: this.observabilityRepository.getLoggingConfig().bufferSize,
      level: this.observabilityRepository.getCurrentLoggingLevel()
    };
  }

  async updateLoggingLevel(body: unknown): Promise<{ success: true; level: LogLevel }> {
    const payload = this.requireBody(body);
    const level = this.parseRequiredLevel(payload.level);

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

  private requireBody(body: unknown): Record<string, unknown> {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new ValidationError('request body must be an object');
    }
    return body as Record<string, unknown>;
  }

  private parseLimit(limitValue: unknown): number {
    const limit = limitValue ? parseInt(String(limitValue), 10) : 200;
    if (Number.isNaN(limit) || limit <= 0) {
      throw new ValidationError('limit must be a positive integer', 'limit');
    }
    return limit;
  }

  private parseOptionalLevel(levelValue: unknown): LogLevel | undefined {
    if (levelValue === undefined || levelValue === null || levelValue === '') {
      return undefined;
    }

    if (typeof levelValue !== 'string' || !VALID_LOG_LEVELS.includes(levelValue as LogLevel)) {
      throw new ValidationError(`level must be one of: ${VALID_LOG_LEVELS.join(', ')}`, 'level');
    }

    return levelValue as LogLevel;
  }

  private parseRequiredLevel(levelValue: unknown): LogLevel {
    const level = this.parseOptionalLevel(levelValue);
    if (!level) {
      throw new ValidationError(`level must be one of: ${VALID_LOG_LEVELS.join(', ')}`, 'level');
    }
    return level;
  }
}
