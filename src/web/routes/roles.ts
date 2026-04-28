/** Role API routes. */

import { Hono } from 'hono';
import type { WebUiManagerDependencies } from '../webui-manager';
import type { RoleConfig } from '../../core/types';

export function createRolesRouter(deps: WebUiManagerDependencies) {
  const router = new Hono();

  router.get('/', (c) => {
    const roles = deps.roleManager.getAllRoles();
    return c.json({ ok: true, data: roles });
  });

  router.get('/:id', (c) => {
    const id = c.req.param('id');
    try {
      const role = deps.roleManager.getRole(id);
      return c.json({ ok: true, data: role });
    } catch {
      return c.json({ ok: false, error: 'Role not found' }, 404);
    }
  });

  router.put('/:id', async (c) => {
    const id = c.req.param('id');
    try {
      const body = (await c.req.json()) as Partial<RoleConfig>;
      const existing = deps.roleManager.getRole(id);
      const updated: RoleConfig = { ...existing, ...body };
      await deps.roleManager.saveRole(id, updated);
      return c.json({ ok: true, data: updated });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: message }, 400);
    }
  });

  return router;
}
