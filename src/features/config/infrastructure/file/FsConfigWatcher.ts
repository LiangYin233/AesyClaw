import { existsSync, watch } from 'fs';
import { basename } from 'path';
import { normalizeConfigError } from '../../errors.js';

type FsWatcher = ReturnType<typeof watch>;

interface LoggerLike {
  debug(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
}

export class FsConfigWatcher {
  private watcher: FsWatcher | null = null;
  private reloadTimer: NodeJS.Timeout | null = null;
  private watcherRestartTimer: NodeJS.Timeout | null = null;

  constructor(private readonly args: {
    getConfigPath: () => string;
    log: LoggerLike;
    onReloadRequested: () => void;
    watchDebounceMs: number;
    watchRetryMs: number;
    maxWatchRestartAttempts: number;
  }) {}

  start(): void {
    if (this.watcher) {
      return;
    }

    try {
      this.watcher = watch(this.args.getConfigPath(), (eventType, filename) => {
        if (!filename || basename(filename.toString()) !== basename(this.args.getConfigPath())) {
          return;
        }

        if (eventType === 'rename') {
          this.stop();
          this.scheduleWatcherRestart();
          this.scheduleReload();
          return;
        }

        if (eventType !== 'change') {
          return;
        }

        this.scheduleReload();
      });
      this.args.log.debug('已启动文件监视器');
    } catch (error) {
      this.args.log.warn('启动配置文件监视器失败', {
        error: normalizeConfigError(error)
      });
    }
  }

  stop(): void {
    this.clearReloadTimer();
    this.clearWatcherRestartTimer();

    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      this.args.log.debug('已停止文件监视器');
    }
  }

  private clearReloadTimer(): void {
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = null;
    }
  }

  private clearWatcherRestartTimer(): void {
    if (this.watcherRestartTimer) {
      clearTimeout(this.watcherRestartTimer);
      this.watcherRestartTimer = null;
    }
  }

  private scheduleReload(): void {
    this.clearReloadTimer();
    this.reloadTimer = setTimeout(() => {
      this.clearReloadTimer();
      this.args.onReloadRequested();
    }, this.args.watchDebounceMs);
  }

  private scheduleWatcherRestart(attemptsRemaining = this.args.maxWatchRestartAttempts): void {
    this.clearWatcherRestartTimer();
    if (attemptsRemaining <= 0 || this.watcher) {
      return;
    }

    this.watcherRestartTimer = setTimeout(() => {
      this.watcherRestartTimer = null;

      if (this.watcher) {
        return;
      }

      if (!existsSync(this.args.getConfigPath())) {
        this.scheduleWatcherRestart(attemptsRemaining - 1);
        return;
      }

      this.start();
      if (this.watcher) {
        this.scheduleReload();
      } else {
        this.scheduleWatcherRestart(attemptsRemaining - 1);
      }
    }, this.args.watchRetryMs);
  }
}
