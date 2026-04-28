/** WebUiManager — HTTP server for the WebUI admin panel. */

import { serve } from '@hono/node-server';
import { randomBytes } from 'node:crypto';
import { createScopedLogger } from '../core/logger';
import type { ConfigManager } from '../core/config/config-manager';
import type { DatabaseManager } from '../core/database/database-manager';
import type { SessionManager } from '../agent/session-manager';
import type { CronManager } from '../cron/cron-manager';
import type { RoleManager } from '../role/role-manager';
import type { ChannelManager } from '../channel/channel-manager';
import type { PluginManager } from '../plugin/plugin-manager';
import { createApp } from './server';

const logger = createScopedLogger('webui');

export interface WebUiManagerDependencies {
  configManager: ConfigManager;
  databaseManager: DatabaseManager;
  sessionManager: SessionManager;
  cronManager: CronManager;
  roleManager: RoleManager;
  channelManager: ChannelManager;
  pluginManager: PluginManager;
}

export class WebUiManager {
  private app: ReturnType<typeof createApp> | null = null;
  private server: ReturnType<typeof serve> | null = null;
  private deps: WebUiManagerDependencies | null = null;

  async initialize(deps: WebUiManagerDependencies): Promise<void> {
    if (this.app) {
      logger.warn('WebUiManager already initialized');
      return;
    }

    this.deps = deps;
    const config = deps.configManager.getConfig();
    const serverConfig = config.server;

    // Auto-generate auth token if missing
    if (!serverConfig.authToken) {
      const token = this.generateToken();
      await deps.configManager.update({ server: { ...serverConfig, authToken: token } });
      logger.info('Auto-generated WebUI auth token');
    }

    this.app = createApp(deps);
    this.server = serve({
      fetch: this.app.fetch,
      port: serverConfig.port,
      hostname: serverConfig.host,
    });

    logger.info('WebUI server started', { host: serverConfig.host, port: serverConfig.port });
  }

  async destroy(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close((err) => {
          if (err && (err as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
            logger.error('Failed to close WebUI server', err);
          }
          resolve();
        });
      });
      this.server = null;
    }
    this.app = null;
    this.deps = null;
    logger.info('WebUI server stopped');
  }

  private generateToken(): string {
    return randomBytes(32).toString('hex');
  }
}
