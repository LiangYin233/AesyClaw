/** WebUiManager — WebUI 管理后台的 HTTP + WebSocket 服务器。 */

import { serve } from '@hono/node-server';
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import { createScopedLogger } from '@aesyclaw/core/logger';
import type { ConfigManager } from '@aesyclaw/core/config/config-manager';
import type { DatabaseManager } from '@aesyclaw/core/database/database-manager';
import type { SessionManager } from '@aesyclaw/session';
import type { CronManager } from '@aesyclaw/cron/cron-manager';
import type { RoleManager } from '@aesyclaw/role/role-manager';
import type { ChannelManager } from '@aesyclaw/extension/channel/channel-manager';
import type { ExtensionManager } from '@aesyclaw/extension/extension-manager';
import type { ToolRegistry } from '@aesyclaw/tool/tool-registry';
import type { SkillManager } from '@aesyclaw/skill/skill-manager';
import type { ResolvedPaths } from '@aesyclaw/core/path-resolver';
import type { WebSocketServer } from 'ws';
import { createApp } from './server';
import { createWebSocketServer } from './ws/handler';

const logger = createScopedLogger('webui');

export type WebUiManagerDependencies = {
  configManager: ConfigManager;
  databaseManager: DatabaseManager;
  sessionManager: SessionManager;
  cronManager: CronManager;
  roleManager: RoleManager;
  channelManager: ChannelManager;
  pluginManager: ExtensionManager;
  toolRegistry: ToolRegistry;
  skillManager: SkillManager;
  paths: Readonly<ResolvedPaths>;
};

export class WebUiManager {
  private deps: WebUiManagerDependencies;
  private app: ReturnType<typeof createApp> | null = null;
  private server: ReturnType<typeof serve> | null = null;
  private wss: WebSocketServer | null = null;

  constructor(deps: WebUiManagerDependencies) {
    this.deps = deps;
  }

  async initialize(): Promise<void> {
    if (this.server) {
      logger.warn('WebUiManager 已初始化 — 跳过');
      return;
    }
    logger.info('WebUiManager 已初始化');

    const port = this.deps.configManager.get('server.port') as number;
    const host = this.deps.configManager.get('server.host') as string;
    const authToken = this.deps.configManager.get('server.authToken') as string | undefined;

    if (!authToken) {
      const token = this.generateToken();
      await this.deps.configManager.set('server.authToken', token);
      logger.info('已自动生成 WebUI 认证令牌', {
        hint: `${token.slice(0, 4)}…${token.slice(-4)}`,
        configPath: 'server.authToken',
      });
    }

    this.app = createApp(this.deps.paths);
    this.server = serve({
      fetch: this.app.fetch,
      port,
      hostname: host,
    });

    this.wss = createWebSocketServer(this.server as unknown as Server, this.deps);

    logger.info('WebUI 服务器已启动（HTTP + WebSocket）', { host, port });
  }

  async destroy(): Promise<void> {
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

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
    logger.info('WebUI 服务器已停止');
  }

  private generateToken(): string {
    return randomBytes(32).toString('hex');
  }
}
