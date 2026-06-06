/** plugin_webui HTTP app factory — SPA fallback and static resources. */

import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WebuiAuthManager } from './auth';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function createApp(options: { webDistDir: string; auth: WebuiAuthManager }): Hono {
  const app = new Hono();

  app.post('/api/auth/login', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'Invalid request body' }, 400);
    }

    const headers = { get: (name: string): string | undefined => c.req.header(name) };
    const token = isRecord(body) && typeof body['token'] === 'string' ? body['token'] : '';
    const result = options.auth.login(token, options.auth.clientKeyFromHeaders(headers));
    if (!result.ok) {
      if (result.retryAfterSeconds !== undefined) {
        c.header('Retry-After', String(result.retryAfterSeconds));
      }
      return c.json({ ok: false, error: result.error }, result.status);
    }

    c.header(
      'Set-Cookie',
      options.auth.makeSessionCookie(
        result.sessionId ?? '',
        options.auth.isSecureRequest(headers, new URL(c.req.url).protocol),
      ),
    );
    return c.json({ ok: true });
  });

  app.post('/api/auth/logout', (c) => {
    options.auth.logout(c.req.header('cookie'));
    c.header('Set-Cookie', options.auth.makeLogoutCookie());
    return c.json({ ok: true });
  });

  app.get('/api/auth/check', (c) => {
    const headers = { get: (name: string): string | undefined => c.req.header(name) };
    const result = options.auth.validateCookie(
      c.req.header('cookie'),
      options.auth.clientKeyFromHeaders(headers),
    );
    if (!result.ok) {
      if (result.retryAfterSeconds !== undefined) {
        c.header('Retry-After', String(result.retryAfterSeconds));
      }
      return c.json({ ok: false, error: result.error }, result.status);
    }

    return c.json({ ok: true });
  });

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
