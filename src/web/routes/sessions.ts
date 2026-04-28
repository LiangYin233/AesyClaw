/** Session API routes. */

import { Hono } from 'hono';
import type { WebUiManagerDependencies } from '../webui-manager';

export function createSessionsRouter(deps: WebUiManagerDependencies) {
  const router = new Hono();

  router.get('/', async (c) => {
    const sessions = await deps.databaseManager.sessions.findAll();
    return c.json({ ok: true, data: sessions });
  });

  router.get('/:id/messages', async (c) => {
    const sessionId = c.req.param('id');
    const session = await deps.databaseManager.sessions.findById(sessionId);
    if (!session) {
      return c.json({ ok: false, error: 'Session not found' }, 404);
    }
    const messages = await deps.databaseManager.messages.loadHistory(sessionId);
    return c.json({ ok: true, data: messages });
  });

  return router;
}
