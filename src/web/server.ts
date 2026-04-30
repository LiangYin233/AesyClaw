/** Hono app factory — registers middleware and routes. */

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
import { createScopedLogger } from '../core/logger';

const logger = createScopedLogger('webui');

export function createApp(deps: WebUiManagerDependencies): Hono {
  const app = new Hono();

  // Auth middleware for API routes
  const authMiddleware = createAuthMiddleware(deps.configManager);
  app.use('/api/*', authMiddleware);

  // API routes
  app.route('/api/sessions', createSessionsRouter(deps));
  app.route('/api/config', createConfigRouter(deps));
  app.route('/api/cron', createCronRouter(deps));
  app.route('/api/roles', createRolesRouter(deps));
  app.route('/api/channels', createChannelsRouter(deps));
  app.route('/api/plugins', createPluginsRouter(deps));
  app.route('/api/status', createStatusRouter(deps));
  app.route('/api/usage', createUsageRouter(deps));

  // Global error handler for API routes
  app.onError((err, c) => {
    logger.error('Unhandled API error', err);
    return c.json({ ok: false, error: err.message }, 500);
  });

  // Static files
  app.use('*', serveStatic({ root: './dist' }));

  // SPA fallback for non-API routes
  app.get('*', (c) => {
    if (c.req.path.startsWith('/api/')) {
      return c.notFound();
    }
    try {
      const html = readFileSync(join(process.cwd(), 'dist/index.html'), 'utf-8');
      return c.html(html);
    } catch {
      return c.text('Not Found', 404);
    }
  });

  return app;
}
