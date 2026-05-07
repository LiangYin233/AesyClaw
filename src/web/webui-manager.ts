/** WebUiManager — WebUI 管理后台的 HTTP + WebSocket 服务器。 */

import { serve } from '@hono/node-server';
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import { createScopedLogger } from '@aesyclaw/core/logger';
import { requireInitialized } from '@aesyclaw/core/utils';
import type { ConfigManager } from '@aesyclaw/core/config/config-manager';
import type { DatabaseManager } from '@aesyclaw/core/database/database-manager';
import type { SessionManager } from '@aesyclaw/session';
import type { CronManager } from '@aesyclaw/cron/cron-manager';
import type { RoleManager } from '@aesyclaw/role/role-manager';
import type { ChannelManager } from '@aesyclaw/extension/channel/channel-manager';
import type { ExtensionManager } from '@aesyclaw/extension/extension-manager';
import type { ToolRegistry } from '@aesyclaw/tool/tool-registry';
import type { SkillManager } from '@aesyclaw/skill/skill-manager';
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
};

export class WebUiManager {
  private deps: WebUiManagerDependencies | null = null;
  private app: ReturnType<typeof createApp> | null = null;
  private server: ReturnType<typeof serve> | null = null;
  private wss: WebSocketServer | null = null;

  async initialize(deps: WebUiManagerDependencies): Promise<void> {
    if (this.deps) {
      logger.warn('WebUiManager 已初始化 — 跳过');
      return;
    }
    this.deps = deps;
    logger.info('WebUiManager 已初始化');

    const port = deps.configManager.get('server.port') as number;
    const host = deps.configManager.get('server.host') as string;
    const authToken = deps.configManager.get('server.authToken') as string | undefined;

    // 如果缺少认证令牌则自动生成
    if (!authToken) {
      const token = this.generateToken();
      await deps.configManager.set('server.authToken', token);
      logger.info('已自动生成 WebUI 认证令牌', {
        hint: `${token.slice(0, 4)}…${token.slice(-4)}`,
        configPath: 'server.authToken',
      });
    }

    this.app = createApp();
    this.server = serve({
      fetch: this.app.fetch,
      port,
      hostname: host,
    });

    // 在同一端口上创建 WebSocket 服务器
    // serve() 总是返回 HTTP Server（纯 HTTP 模式下），使用类型断言
    this.wss = createWebSocketServer(this.server as unknown as Server, deps);

    logger.info('WebUI 服务器已启动（HTTP + WebSocket）', { host, port });
  }

  async destroy(): Promise<void> {
    // 先关闭 WebSocket 服务器
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
    this.deps = null;
    logger.info('WebUI 服务器已停止');
  }

  private requireDeps(): WebUiManagerDependencies {
    return requireInitialized(this.deps, 'WebUiManager');
  }

  private generateToken(): string {
    return randomBytes(32).toString('hex');
  }
}
