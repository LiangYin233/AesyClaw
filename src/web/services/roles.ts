/** 角色 Service。 */

import type { WebUiManagerDependencies } from '@aesyclaw/web/webui-manager';
import type { RoleConfig } from '@aesyclaw/core/types';
import { parseModelIdentifier } from '@aesyclaw/core/utils';

/**
 * 获取所有角色。
 */
export function getRoles(deps: WebUiManagerDependencies): RoleConfig[] {
  return deps.roleManager.getAllRoles();
}

/**
 * 获取单个角色。
 */
export function getRole(deps: WebUiManagerDependencies, id: string): RoleConfig {
  // getRole 在未找到时抛出异常
  return deps.roleManager.getRole(id);
}

/**
 * 创建角色。
 */
export async function createRole(
  deps: WebUiManagerDependencies,
  body: Partial<RoleConfig> & { model: string },
): Promise<RoleConfig> {
  if (!body.model) {
    throw new Error('模型为必填项');
  }

  // 验证 model 对应的 provider 和 modelId 存在
  const { provider: providerName, modelId } = parseModelIdentifier(body.model);
  const provider = deps.configManager.get(`providers.${providerName}`) as
    | { models?: Record<string, unknown> }
    | undefined;
  if (provider === undefined) {
    throw new Error(`提供商 "${providerName}" 未配置`);
  }
  if (provider.models === undefined || !(modelId in provider.models)) {
    throw new Error(`提供商 "${providerName}" 中未找到模型 "${modelId}"`);
  }

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

  const updated: RoleConfig = { ...current, ...body, id };
  await deps.roleManager.saveRole(id, updated);
  return updated;
}

/**
 * 删除角色。
 */
export async function deleteRole(deps: WebUiManagerDependencies, id: string): Promise<void> {
  await deps.roleManager.deleteRole(id);
}
