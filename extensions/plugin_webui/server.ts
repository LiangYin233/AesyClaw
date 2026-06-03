/** plugin_webui HTTP app factory — SPA fallback and static resources. */

import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function createApp(options: { webDistDir: string }): Hono {
  const app = new Hono();

  app.get('/api/ws', (c) => c.notFound());

  if (existsSync(options.webDistDir)) {
    app.use('*', serveStatic({ root: options.webDistDir }));
  }

  const indexHtmlPath = join(options.webDistDir, 'index.html');
  let cachedIndexHtml: string | null = null;

  app.get('*', (c) => {
    if (c.req.path.startsWith('/api/')) return c.notFound();
    if (cachedIndexHtml === null) {
      try {
        cachedIndexHtml = readFileSync(indexHtmlPath, 'utf-8');
      } catch {
        return c.text(`WebUI build not found: ${indexHtmlPath}`, 404);
      }
    }
    return c.html(cachedIndexHtml);
  });

  return app;
}
