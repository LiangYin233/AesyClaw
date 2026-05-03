/** 状态 API 路由。 */

import { Hono } from 'hono';
import type { WebUiManagerDependencies } from '@aesyclaw/web/webui-manager';
import { APP_NAME, APP_VERSION } from '@aesyclaw/core/types';

/**
 * 创建状态 API 路由。
 *
 * @param deps - WebUiManager 的依赖项
 * @returns Hono 路由器实例
 */
export function createStatusRouter(deps: WebUiManagerDependencies): Hono {
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
        channels: channels.map((ch) => ({
          name: ch.name,
          state: ch.state,
          version: ch.version,
          error: ch.error,
        })),
        database: stats,
      },
    });
  });

  return router;
}
