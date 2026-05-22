/**
 * file-watcher — 配置文件热重载监视器。
 *
 * 从 ConfigManager 中提取，专注于使用 conf 库的 onDidAnyChange
 * 监听配置文件变更并触发回调。
 */

import { createScopedLogger } from '@aesyclaw/core/logger';

const logger = createScopedLogger('config-file-watcher');

/**
 * 配置文件热重载监视器。
 * 封装 start/stop 生命周期，通过回调通知 ConfigManager 重新加载。
 */
export class ConfigFileWatcher {
  private unsubscribe?: () => void;
  private readonly onConfigChange: () => void;

  /**
   * @param onConfigChange - 配置文件变更时触发的回调（通常为 ConfigManager.reloadFromFile）
   */
  constructor(onConfigChange: () => void) {
    this.onConfigChange = onConfigChange;
  }

  /** 启动监视器。停止已存在的监视器后再重新启动。 */
  start(configStore: { onDidAnyChange: (cb: () => void) => () => void }): void {
    this.stop();
    this.unsubscribe = configStore.onDidAnyChange(() => {
      this.onConfigChange();
    });
    logger.info('热重载监视器已启动');
  }

  /** 停止监视器。幂等 —— 多次调用不会重复停止。 */
  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    logger.info('热重载监视器已停止');
  }
}
