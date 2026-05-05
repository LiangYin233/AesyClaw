/** 会话 API 路由。 */

import { Hono } from 'hono';
import type { WebUiManagerDependencies } from '@aesyclaw/web/webui-manager';

/**
 * 创建会话 API 路由。
 *
 * @param deps - WebUiManager 的依赖项
 * @returns Hono 路由器实例
 */
export function createSessionsRouter(deps: WebUiManagerDependencies): Hono {
  const router = new Hono();

  router.get('/', async (c) => {
    const data = await deps.databaseManager.sessions.findAll();
    return c.json({ ok: true, data });
  });

  router.get('/:id/messages', async (c) => {
    const sessionId = c.req.param('id');
    const session = await deps.databaseManager.sessions.findById(sessionId);
    if (!session) {
      return c.json({ ok: false, error: '会话未找到' }, 404);
    }
    const messages = await deps.databaseManager.messages.loadHistory(sessionId);
    return c.json({ ok: true, data: messages });
  });

  return router;
}
