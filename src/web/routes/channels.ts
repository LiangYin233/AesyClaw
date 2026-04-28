/** Channel API routes. */

import { Hono } from 'hono';
import type { WebUiManagerDependencies } from '../webui-manager';

export function createChannelsRouter(deps: WebUiManagerDependencies) {
  const router = new Hono();

  router.get('/', (c) => {
    const channels = deps.channelManager.getRegisteredChannels();
    return c.json({ ok: true, data: channels });
  });

  return router;
}
