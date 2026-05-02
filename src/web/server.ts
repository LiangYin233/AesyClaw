/** Hono 应用工厂 — 注册中间件和路由。 */

import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WebUiManagerDependencies } from './webui-manager';
import { createAuthMiddleware } from './middleware/auth';
import { createSessionsRouter } from './routes/sessions';
import { createConfigRouter } from './routes/config';
import { createCronRouter } from './routes/cron';
import { createRolesRouter } from './routes/roles';
import { createChannelsRouter } from './routes/channels';
import { createPluginsRouter } from './routes/plugins';
import { createStatusRouter } from './routes/status';
import { createUsageRouter } from './routes/usage';
import { createLogsRouter } from './routes/logs';
import { createToolsRouter } from './routes/tools';
import { createSkillsRouter } from './routes/skills';
import { createScopedLogger } from '../core/logger';

const logger = createScopedLogger('webui');

export function createApp(deps: WebUiManagerDependencies): Hono {
  const app = new Hono();

  // API 路由的认证中间件
  const authMiddleware = createAuthMiddleware(deps.configManager);
  app.use('/api/*', authMiddleware);

  // API 路由
  app.route('/api/sessions', createSessionsRouter(deps));
  app.route('/api/config', createConfigRouter(deps));
  app.route('/api/cron', createCronRouter(deps));
  app.route('/api/roles', createRolesRouter(deps));
  app.route('/api/channels', createChannelsRouter(deps));
  app.route('/api/plugins', createPluginsRouter(deps));
  app.route('/api/status', createStatusRouter(deps));
  app.route('/api/usage', createUsageRouter(deps));
  app.route('/api/logs', createLogsRouter(deps));
  app.route('/api/tools', createToolsRouter(deps));
  app.route('/api/skills', createSkillsRouter(deps));

  // API 路由的全局错误处理器
  app.onError((err, c) => {
    logger.error('未处理的 API 错误', err);
    return c.json({ ok: false, error: err.message }, 500);
  });

  // 静态文件
  app.use('*', serveStatic({ root: './dist' }));

  // 非 API 路由的 SPA 回退
  app.get('*', (c) => {
    if (c.req.path.startsWith('/api/')) {
      return c.notFound();
    }
    try {
      const html = readFileSync(join(process.cwd(), 'dist/index.html'), 'utf-8');
      return c.html(html);
    } catch {
      return c.text('未找到', 404);
    }
  });

  return app;
}
