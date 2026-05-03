/** 频道 API 路由。 */

import { Hono } from 'hono';
import type { WebUiManagerDependencies } from '../webui-manager';

/**
 * 创建频道 API 路由。
 *
 * @param deps - WebUiManager 的依赖项
 * @returns Hono 路由器实例
 */
export function createChannelsRouter(deps: WebUiManagerDependencies): Hono {
  const router = new Hono();

  router.get('/', (c) => {
    const channels = deps.channelManager.getRegisteredChannels();
    return c.json({ ok: true, data: channels });
  });

  return router;
}
