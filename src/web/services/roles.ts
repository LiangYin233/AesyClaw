/** 角色 Service。 */

import type { WebUiManagerDependencies } from '@aesyclaw/web/webui-manager';
import type { RoleConfig } from '@aesyclaw/core/types';
import { parseModelIdentifier } from '@aesyclaw/core/utils';

/**
 * 获取所有角色。
 *
 * @param deps - WebUI 管理器依赖项
 * @returns 角色配置数组
 */
export function getRoles(deps: WebUiManagerDependencies): RoleConfig[] {
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
export function getRole(deps: WebUiManagerDependencies, id: string): RoleConfig {
  // getRole 在未找到时抛出异常
  return deps.roleManager.getRole(id);
}

function validateProviderModel(deps: WebUiManagerDependencies, model: string): void {
  const { provider: providerName, modelId } = parseModelIdentifier(model);
  const provider = deps.configManager.get(`providers.${providerName}`) as
    | { models?: Record<string, unknown> }
    | undefined;
  if (provider === undefined) {
    throw new Error(`提供商 "${providerName}" 未配置`);
  }
  if (provider.models === undefined || !(modelId in provider.models)) {
    throw new Error(`提供商 "${providerName}" 中未找到模型 "${modelId}"`);
  }
}

/**
 * 创建角色。
 *
 * @param deps - WebUI 管理器依赖项
 * @param body - 角色部分配置（model 为必填）
 * @returns 创建的角色配置
 * @throws model 缺失或提供商/模型校验失败时抛出
 */
export async function createRole(
  deps: WebUiManagerDependencies,
  body: Partial<RoleConfig> & { model: string },
): Promise<RoleConfig> {
  if (!body.model) {
    throw new Error('模型为必填项');
  }

  validateProviderModel(deps, body.model);

  const role = await deps.roleManager.createRole({
    description: body.description ?? '',
    systemPrompt: body.systemPrompt ?? '',
    model: body.model,
    toolPermission: body.toolPermission ?? { mode: 'allowlist', list: [] },
    skills: body.skills ?? ([] as string[]),
    enabled: body.enabled ?? true,
    id: body.id,
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
  deps: WebUiManagerDependencies,
  id: string,
  body: Partial<RoleConfig>,
): Promise<RoleConfig> {
  if (body.id !== undefined && body.id !== id) {
    throw new Error('请求体中的角色 id 必须与路由 id 一致');
  }

  const current = deps.roleManager.getRole(id);
  const model = body.model ?? current.model;
  validateProviderModel(deps, model);

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
export async function deleteRole(deps: WebUiManagerDependencies, id: string): Promise<void> {
  await deps.roleManager.deleteRole(id);
}
