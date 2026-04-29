/** Config API routes. */

import { Hono } from 'hono';
import type { WebUiManagerDependencies } from '../webui-manager';
import { AppConfigSchema, type AppConfig } from '../../core/config/schema';
import type { DeepPartial } from '../../core/types';

export function createConfigRouter(deps: WebUiManagerDependencies) {
  const router = new Hono();

  router.get('/', (c) => {
    const config = deps.configManager.getConfig();
    return c.json({ ok: true, data: config });
  });

  router.get('/schema', (c) => {
    return c.json({ ok: true, data: AppConfigSchema });
  });

  router.put('/', async (c) => {
    try {
      const body = (await c.req.json()) as DeepPartial<AppConfig>;
      await deps.configManager.update(body, { replaceTopLevelKeys: ['channels', 'plugins'] });
      return c.json({ ok: true, data: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: message }, 400);
    }
  });

  return router;
}
