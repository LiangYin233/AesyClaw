import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';
import { logger } from './logging.js';

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requestCount: number;
  lastUpdated: Date;
}

export interface UsageConfig {
  enabled: boolean;
  persistFile: string;
  flushIntervalMs: number;
}

export class TokenUsageTracker {
  private log = logger.child('Usage');
  private config: UsageConfig = {
    enabled: true,
    persistFile: 'token-usage.json',
    flushIntervalMs: 30000
  };
  private stats: TokenUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    requestCount: 0,
    lastUpdated: new Date()
  };
  private dirty = false;
  private saveInterval: NodeJS.Timeout;

  constructor() {
    this.saveInterval = setInterval(() => {
      if (this.dirty) {
        this.flush();
      }
    }, this.config.flushIntervalMs);
  }

  configure(partial: Partial<UsageConfig>): void {
    const previousFile = this.config.persistFile;
    const previousInterval = this.config.flushIntervalMs;
    this.config = {
      ...this.config,
      ...partial
    };

    if (previousInterval !== this.config.flushIntervalMs) {
      clearInterval(this.saveInterval);
      this.saveInterval = setInterval(() => {
        if (this.dirty) {
          this.flush();
        }
      }, this.config.flushIntervalMs);
    }

    if (previousFile !== this.config.persistFile) {
      if (this.dirty) {
        this.saveToFile(previousFile);
      }
      this.loadFromConfiguredFile();
    } else if (partial.enabled !== undefined && this.config.enabled) {
      this.loadFromConfiguredFile();
    }
  }

  setDataDir(dataDir: string): void {
    this.configure({
      persistFile: join(dataDir, 'token-usage.json')
    });
  }

  record(promptTokens: number, completionTokens: number, totalTokens: number): void {
    if (!this.config.enabled) {
      return;
    }

    this.stats.promptTokens += promptTokens;
    this.stats.completionTokens += completionTokens;
    this.stats.totalTokens += totalTokens;
    this.stats.requestCount += 1;
    this.stats.lastUpdated = new Date();
    this.dirty = true;
  }

  getStats(): TokenUsage {
    return { ...this.stats };
  }

  getConfig(): UsageConfig {
    return { ...this.config };
  }

  reset(): void {
    this.stats = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      requestCount: 0,
      lastUpdated: new Date()
    };
    this.dirty = true;
    this.flush();
    this.log.info('Token usage reset');
  }

  destroy(): void {
    clearInterval(this.saveInterval);
    if (this.dirty) {
      this.flush();
    }
  }

  private loadFromConfiguredFile(): void {
    try {
      if (!this.config.enabled || !existsSync(this.config.persistFile)) {
        return;
      }

      const data = JSON.parse(readFileSync(this.config.persistFile, 'utf-8')) as Omit<TokenUsage, 'lastUpdated'> & { lastUpdated: string };
      this.stats = {
        ...data,
        lastUpdated: new Date(data.lastUpdated)
      };
      this.log.info('Token usage loaded', {
        persistFile: this.config.persistFile,
        totalTokens: this.stats.totalTokens,
        requestCount: this.stats.requestCount
      });
    } catch (error) {
      this.log.warn('Failed to load token usage', {
        persistFile: this.config.persistFile,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private flush(): void {
    this.saveToFile(this.config.persistFile);
    this.dirty = false;
  }

  private saveToFile(filePath: string): void {
    try {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, JSON.stringify(this.stats, null, 2), 'utf-8');
    } catch (error) {
      this.log.error('Failed to save token usage', {
        persistFile: filePath,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

export const tokenUsage = new TokenUsageTracker();
