/** Hono 应用工厂 — 仅保留 SPA 回退。REST API 已停用，全部走 WebSocket。 */

import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ResolvedPaths } from '@aesyclaw/core/path-resolver';

export function createApp(paths: Pick<ResolvedPaths, 'webDistDir'>): Hono {
  const app = new Hono();

  // WebSocket 路径需要被 Hono 识别，避免走到 SPA 回退
  app.get('/api/ws', (c) => c.notFound());

  app.use('*', serveStatic({ root: paths.webDistDir }));

  const indexHtmlPath = join(paths.webDistDir, 'index.html');
  let cachedIndexHtml: string | null = null;

  app.get('*', (c) => {
    if (c.req.path.startsWith('/api/')) {
      return c.notFound();
    }
    if (cachedIndexHtml === null) {
      try {
        cachedIndexHtml = readFileSync(indexHtmlPath, 'utf-8');
      } catch {
        return c.text('未找到', 404);
      }
    }
    return c.html(cachedIndexHtml);
  });

  return app;
}
