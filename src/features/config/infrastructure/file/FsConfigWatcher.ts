import { existsSync, watch } from 'fs';
import { basename } from 'path';

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
    } catch {
    }
  }

  stop(): void {
    this.clearReloadTimer();
    this.clearWatcherRestartTimer();

    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
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
