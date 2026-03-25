import { logging, tokenUsage, type LogLevel } from '../../platform/observability/index.js';
import type { Config } from '../../types.js';

export class ObservabilityRepository {
  constructor(
    private readonly updateConfigValue: (mutator: (config: Config) => void | Config | Promise<void | Config>) => Promise<Config>
  ) {}

  getLoggingConfig(): ReturnType<typeof logging.getConfig> {
    return logging.getConfig();
  }

  getLoggingEntries(params: { limit: number; level?: LogLevel }): ReturnType<typeof logging.getEntries> {
    return logging.getEntries(params);
  }

  getLoggingBufferSize(): number {
    return logging.getBufferSize();
  }

  getCurrentLoggingLevel(): LogLevel {
    return logging.getLevel();
  }

  setLoggingLevel(level: LogLevel): void {
    logging.setLevel(level);
  }

  async updateConfig(
    mutator: (config: Config) => void | Config | Promise<void | Config>
  ): Promise<Config> {
    return this.updateConfigValue(mutator);
  }

  getUsageStats() {
    return tokenUsage.getStats();
  }

  resetUsage(): void {
    tokenUsage.reset();
  }
}
