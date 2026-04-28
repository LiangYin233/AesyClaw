/** Status API routes. */

import { Hono } from 'hono';
import type { WebUiManagerDependencies } from '../webui-manager';
import { APP_NAME, APP_VERSION } from '../../core/types';

export function createStatusRouter(deps: WebUiManagerDependencies) {
  const router = new Hono();

  router.get('/', (c) => {
    const channels = deps.channelManager.listChannels();
    const stats = deps.databaseManager.getStats();

    return c.json({
      ok: true,
      data: {
        app: APP_NAME,
        version: APP_VERSION,
        uptime: process.uptime(),
        channels: channels.map((ch) => ({ name: ch.name, state: ch.state })),
        database: stats,
      },
    });
  });

  return router;
}
