/** Plugin API routes. */

import { Hono } from 'hono';
import type { WebUiManagerDependencies } from '../webui-manager';

export function createPluginsRouter(deps: WebUiManagerDependencies) {
  const router = new Hono();

  router.get('/', async (c) => {
    const plugins = await deps.pluginManager.getPluginDefinitions();
    return c.json({ ok: true, data: plugins });
  });

  return router;
}
