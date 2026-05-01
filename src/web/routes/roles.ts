/** 角色 API 路由。 */

import { Hono } from 'hono';
import type { WebUiManagerDependencies } from '../webui-manager';
import type { RoleConfig } from '../../core/types';

/**
 * 创建角色 API 路由。
 *
 * @param deps - WebUiManager 的依赖项
 * @returns Hono 路由器实例
 */
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
      return c.json({ ok: false, error: '角色未找到' }, 404);
    }
  });

  router.put('/:id', async (c) => {
    const id = c.req.param('id');
    try {
      const body = (await c.req.json()) as Partial<RoleConfig>;
      if (body.id !== undefined && body.id !== id) {
        return c.json({ ok: false, error: '请求体中的角色 id 必须与路由 id 一致' }, 400);
      }
      const model = body.model ?? deps.roleManager.getRole(id).model;
      const slashIdx = model.indexOf('/');
      if (slashIdx === -1) {
        return c.json({ ok: false, error: '模型必须是 provider/model 格式' }, 400);
      }
      const providerName = model.slice(0, slashIdx);
      const modelId = model.slice(slashIdx + 1);
      const config = deps.configManager.getConfig();
      const provider = config.providers[providerName];
      if (provider === undefined) {
        return c.json({ ok: false, error: `提供商 "${providerName}" 未配置` }, 400);
      }
      if (provider.models === undefined || !(modelId in provider.models)) {
        return c.json({ ok: false, error: `提供商 "${providerName}" 中未找到模型 "${modelId}"` }, 400);
      }
      const existing = deps.roleManager.getRole(id);
      const updated: RoleConfig = { ...existing, ...body, id };
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
        return c.json({ ok: false, error: '名称和模型为必填项' }, 400);
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

  router.delete('/:id', async (c) => {
    const id = c.req.param('id');
    try {
      await deps.roleManager.deleteRole(id);
      return c.json({ ok: true, data: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: message }, 400);
    }
  });

  return router;
}
