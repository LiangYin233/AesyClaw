/** WebUiManager — WebUI 管理后台的 HTTP 服务器。 */

import { serve } from '@hono/node-server';
import { randomBytes } from 'node:crypto';
import { createScopedLogger } from '../core/logger';
import { BaseManager } from '../core/base-manager';
import type { ConfigManager } from '../core/config/config-manager';
import type { DatabaseManager } from '../core/database/database-manager';
import type { SessionManager } from '../agent/session-manager';
import type { CronManager } from '../cron/cron-manager';
import type { RoleManager } from '../role/role-manager';
import type { ChannelManager } from '../channel/channel-manager';
import type { PluginManager } from '../plugin/plugin-manager';
import { createApp } from './server';

const logger = createScopedLogger('webui');

export type WebUiManagerDependencies = {
  configManager: ConfigManager;
  databaseManager: DatabaseManager;
  sessionManager: SessionManager;
  cronManager: CronManager;
  roleManager: RoleManager;
  channelManager: ChannelManager;
  pluginManager: PluginManager;
}

export class WebUiManager extends BaseManager<WebUiManagerDependencies> {
  private app: ReturnType<typeof createApp> | null = null;
  private server: ReturnType<typeof serve> | null = null;

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  async initialize(deps: WebUiManagerDependencies): Promise<void> {
    if (this.deps) {
      this.logger.warn('WebUiManager 已初始化 — 跳过');
      return;
    }
    super.initialize(deps);

    const config = deps.configManager.getConfig();
    const serverConfig = config.server;

    // 如果缺少认证令牌则自动生成
    if (!serverConfig.authToken) {
      const token = this.generateToken();
      await deps.configManager.update({ server: { ...serverConfig, authToken: token } });
      logger.info('已自动生成 WebUI 认证令牌', {
        hint: `${token.slice(0, 4)}…${token.slice(-4)}`,
        configPath: 'server.authToken',
      });
    }

    this.app = createApp(deps);
    this.server = serve({
      fetch: this.app.fetch,
      port: serverConfig.port,
      hostname: serverConfig.host,
    });

    logger.info('WebUI 服务器已启动', { host: serverConfig.host, port: serverConfig.port });
  }

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  async destroy(): Promise<void> {
    const server = this.server;
    if (server) {
      await new Promise<void>((resolve) => {
        server.close((err) => {
          if (err && (err as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
            logger.error('关闭 WebUI 服务器失败', err);
          }
          resolve();
        });
      });
      this.server = null;
    }
    this.app = null;
    super.destroy();
    logger.info('WebUI 服务器已停止');
  }

  private generateToken(): string {
    return randomBytes(32).toString('hex');
  }
}
