/** 角色 Service。 */

import type { WebRuntimeDependencies } from '@aesyclaw/web/types';
import type { RoleConfig } from '@aesyclaw/core/types';

/**
 * 获取所有角色。
 *
 * @param deps - WebUI 管理器依赖项
 * @returns 角色配置数组
 */
export function getRoles(deps: WebRuntimeDependencies): RoleConfig[] {
  return deps.roleManager.getAllRoles();
}

/**
 * 获取单个角色。
 *
 * @param deps - WebUI 管理器依赖项
 * @param id - 角色 ID
 * @returns 角色配置
 * @throws 角色未找到时抛出
 */
export function getRole(deps: WebRuntimeDependencies, id: string): RoleConfig {
  // getRole 在未找到时抛出异常
  return deps.roleManager.getRole(id);
}

/**
 * 创建角色。
 *
 * @param deps - WebUI 管理器依赖项
 * @param body - 角色部分配置
 * @returns 创建的角色配置
 */
export async function createRole(
  deps: WebRuntimeDependencies,
  body: Partial<RoleConfig>,
): Promise<RoleConfig> {
  const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : undefined;

  const role = await deps.roleManager.createRole({
    description: body.description ?? '',
    systemPrompt: body.systemPrompt ?? '',
    toolPermission: body.toolPermission ?? { mode: 'allowlist', list: [] },
    skills: body.skills ?? ([] as string[]),
    enabled: body.enabled ?? true,
    id,
  });
  return role;
}

/**
 * 更新角色。
 *
 * @param deps - WebUI 管理器依赖项
 * @param id - 角色 ID
 * @param body - 要更新的字段
 * @returns 更新后的角色配置
 * @throws id 不一致或提供商/模型校验失败时抛出
 */
export async function updateRole(
  deps: WebRuntimeDependencies,
  id: string,
  body: Partial<RoleConfig>,
): Promise<RoleConfig> {
  if (body.id !== undefined && body.id !== id) {
    throw new Error('请求体中的角色 id 必须与路由 id 一致');
  }

  const current = deps.roleManager.getRole(id);
  const updated: RoleConfig = { ...current, ...body, id };
  await deps.roleManager.saveRole(id, updated);
  return updated;
}

/**
 * 删除角色。
 *
 * @param deps - WebUI 管理器依赖项
 * @param id - 角色 ID
 */
export async function deleteRole(deps: WebRuntimeDependencies, id: string): Promise<void> {
  await deps.roleManager.deleteRole(id);
}
