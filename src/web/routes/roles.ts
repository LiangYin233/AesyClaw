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
      const model = body.model ?? deps.roleManager.getRole(id).model;
      const slashIdx = model.indexOf('/');
      if (slashIdx === -1) {
        return c.json({ ok: false, error: 'Model must be in provider/model format' }, 400);
      }
      const providerName = model.slice(0, slashIdx);
      const modelId = model.slice(slashIdx + 1);
      const config = deps.configManager.getConfig();
      const provider = config.providers[providerName];
      if (!provider) {
        return c.json({ ok: false, error: `Provider "${providerName}" not configured` }, 400);
      }
      if (!provider.models || !(modelId in provider.models)) {
        return c.json({ ok: false, error: `Model "${modelId}" not found in provider "${providerName}"` }, 400);
      }
      const existing = deps.roleManager.getRole(id);
      const updated: RoleConfig = { ...existing, ...body };
      await deps.roleManager.saveRole(id, updated);
      return c.json({ ok: true, data: updated });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: message }, 400);
    }
  });

  router.post('/', async (c) => {
    try {
      const body = (await c.req.json()) as Partial<RoleConfig> & { name: string; model: string };
      if (!body.name || !body.model) {
        return c.json({ ok: false, error: 'Name and model are required' }, 400);
      }
      const role = await deps.roleManager.createRole({
        name: body.name,
        description: body.description ?? '',
        systemPrompt: body.systemPrompt ?? '',
        model: body.model,
        toolPermission: body.toolPermission ?? { mode: 'allowlist', list: [] },
        skills: body.skills ?? ([] as string[]),
        enabled: body.enabled ?? true,
        id: body.id,
      });
      return c.json({ ok: true, data: role }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: message }, 400);
    }
  });

  return router;
}
