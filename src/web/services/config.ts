/** 配置 Service。 */

import type { WebRuntimeDependencies } from '@aesyclaw/web/types';
import { AppConfigSchema, type AppConfig } from '@aesyclaw/core/config/schema';
import type { DeepPartial } from '@aesyclaw/core/types';

/**
 * 获取当前配置。
 *
 * @param deps - WebUI 管理器依赖项
 * @returns 完整的应用配置对象
 */
export function getConfig(deps: WebRuntimeDependencies): AppConfig {
  return {
    server: deps.configManager.get('server') as AppConfig['server'],
    providers: deps.configManager.get('providers') as AppConfig['providers'],
    channels: deps.configManager.get('channels') as AppConfig['channels'],
    agent: deps.configManager.get('agent') as AppConfig['agent'],
    mcp: deps.configManager.get('mcp') as AppConfig['mcp'],
    plugins: deps.configManager.get('plugins') as AppConfig['plugins'],
  };
}

/**
 * 获取配置 JSON Schema。
 *
 * @returns AppConfig 的 JSON Schema 定义
 */
export function getConfigSchema(): typeof AppConfigSchema {
  return AppConfigSchema;
}

/**
 * 更新配置。
 *
 * @param deps - WebUI 管理器依赖项
 * @param body - 部分配置更新对象
 */
export async function updateConfig(
  deps: WebRuntimeDependencies,
  body: DeepPartial<AppConfig>,
): Promise<void> {
  await deps.configManager.update(body as Record<string, unknown>);
  deps.configManager.onConfigReloaded?.();
}
