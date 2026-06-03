/**
 * file-watcher — 配置文件热重载监视器。
 *
 * 从 ConfigManager 中提取，专注于监听配置文件变更并触发回调。
 */

import { watch, type FSWatcher } from 'node:fs';
import { basename, dirname } from 'node:path';
import { createScopedLogger } from '@aesyclaw/core/logger';

const logger = createScopedLogger('config-file-watcher');

/**
 * 配置文件热重载监视器。
 * 封装 start/stop 生命周期，通过回调通知 ConfigManager 重新加载。
 */
export class ConfigFileWatcher {
  private unsubscribe?: () => void;
  private fsWatcher?: FSWatcher;
  private debounceTimer?: ReturnType<typeof setTimeout>;
  private readonly onConfigChange: () => void;

  /**
   * @param onConfigChange - 配置文件变更时触发的回调（通常为 ConfigManager.reloadFromFile）
   */
  constructor(onConfigChange: () => void) {
    this.onConfigChange = onConfigChange;
  }

  /** 启动监视器。停止已存在的监视器后再重新启动。 */
  start(configStore: { onDidAnyChange: (cb: () => void) => () => void }, configPath: string): void {
    this.stop();

    const scheduleReload = (): void => {
      if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = undefined;
        this.onConfigChange();
      }, 50);
    };

    this.unsubscribe = configStore.onDidAnyChange(scheduleReload);
    const configFileName = basename(configPath);
    this.fsWatcher = watch(dirname(configPath), (_eventType, filename) => {
      if (filename === null || filename === configFileName) scheduleReload();
    });
    this.fsWatcher.on('error', (err) => {
      logger.error('配置文件热重载监听失败', err);
    });

    logger.info('热重载监视器已启动');
  }

  /** 停止监视器。幂等 —— 多次调用不会重复停止。 */
  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.fsWatcher?.close();
    this.fsWatcher = undefined;
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    logger.info('热重载监视器已停止');
  }
}
