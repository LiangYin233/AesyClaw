/** 配置 API 路由。 */

import { Hono } from 'hono';
import type { WebUiManagerDependencies } from '@aesyclaw/web/webui-manager';
import { AppConfigSchema, type AppConfig } from '@aesyclaw/core/config/schema';
import type { DeepPartial } from '@aesyclaw/core/types';

/**
 * 创建配置 API 路由。
 *
 * @param deps - WebUiManager 的依赖项
 * @returns Hono 路由器实例
 */
export function createConfigRouter(deps: WebUiManagerDependencies): Hono {
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
