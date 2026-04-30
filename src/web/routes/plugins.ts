/** 插件 API 路由。 */

import { Hono } from 'hono';
import type { WebUiManagerDependencies } from '../webui-manager';

/**
 * 创建插件 API 路由。
 *
 * @param deps - WebUiManager 的依赖项
 * @returns Hono 路由器实例
 */
export function createPluginsRouter(deps: WebUiManagerDependencies) {
  const router = new Hono();

  router.get('/', async (c) => {
    const plugins = await deps.pluginManager.getPluginDefinitions();
    return c.json({ ok: true, data: plugins });
  });

  return router;
}
