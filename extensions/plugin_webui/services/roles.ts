import type { PluginContext, RoleConfig } from '@aesyclaw/sdk';

export function getRoles(ctx: PluginContext): ReturnType<PluginContext['control']['roles']['list']> {
  return ctx.control.roles.list();
}

export function getRole(
  ctx: PluginContext,
  id: string,
): ReturnType<PluginContext['control']['roles']['get']> {
  return ctx.control.roles.get(id);
}

export function createRole(
  ctx: PluginContext,
  body: Omit<RoleConfig, 'id'> & { id?: string },
): ReturnType<PluginContext['control']['roles']['create']> {
  return ctx.control.roles.create(body);
}

export function updateRole(
  ctx: PluginContext,
  id: string,
  body: Partial<RoleConfig>,
): ReturnType<PluginContext['control']['roles']['update']> {
  return ctx.control.roles.update(id, body);
}

export function deleteRole(
  ctx: PluginContext,
  id: string,
): ReturnType<PluginContext['control']['roles']['delete']> {
  return ctx.control.roles.delete(id);
}
