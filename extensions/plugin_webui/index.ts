import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { serve } from '@hono/node-server';
import type { Server } from 'node:http';
import type { WebSocketServer } from 'ws';
import type { PluginDefinition } from '@aesyclaw/sdk';
import { WebuiPluginConfigSchema, type WebuiPluginConfig } from './config-schema';
import { createApp } from './server';
import { createWebSocketServer } from './ws/handler';

let httpServer: ReturnType<typeof serve> | null = null;
let wsServer: WebSocketServer | null = null;

const plugin: PluginDefinition = {
  name: 'webui',
  version: '0.1.0',
  description: 'WebUI backend plugin shell.',
  configSchema: WebuiPluginConfigSchema,
  permissions: {
    config: {
      read: ['server', 'providers', 'channels', 'agent', 'mcp', 'plugins'],
      write: [
        'server',
        'providers',
        'channels',
        'channels.*.enabled',
        'agent',
        'mcp',
        'plugins',
        'plugins.*.enabled',
      ],
    },
  },

  async init(ctx) {
    if (!ctx.config.self.get<string>('authToken')) {
      const token = randomBytes(32).toString('hex');
      await ctx.config.self.set('authToken', token);
      ctx.log.info('已自动生成 plugin_webui 认证令牌', {
        hint: `${token.slice(0, 4)}…${token.slice(-4)}`,
        configPath: 'plugins.webui.authToken',
      });
    }

    const config = ctx.config.self.get<WebuiPluginConfig>('') ?? ({} as WebuiPluginConfig);
    if (config.enabledServer !== true) {
      ctx.log.info('plugin_webui server 未启动（enabledServer=false，core WebUI 仍由 src/web 提供）');
      return;
    }

    const host = config.host ?? '127.0.0.1';
    const port = config.port ?? 3000;
    const webDistDir = path.join(process.cwd(), 'dist');

    const app = createApp({ webDistDir });
    httpServer = serve({ fetch: app.fetch, port, hostname: host });
    wsServer = createWebSocketServer(httpServer as unknown as Server, ctx);

    ctx.log.info('plugin_webui server 已启动（HTTP + WebSocket）', { host, port, webDistDir });
  },

  async destroy(ctx) {
    if (wsServer) {
      wsServer.close();
      wsServer = null;
    }

    const server = httpServer;
    if (server) {
      await new Promise<void>((resolve) => {
        server.close((err) => {
          if (err && (err as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
            ctx.log.error('关闭 plugin_webui server 失败', err);
          }
          resolve();
        });
      });
      httpServer = null;
    }
  },
};

export default plugin;
