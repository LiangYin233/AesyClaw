/** 配置 Service。 */

import type { WebUiManagerDependencies } from '@aesyclaw/web/webui-manager';
import { AppConfigSchema, type AppConfig } from '@aesyclaw/core/config/schema';
import type { DeepPartial } from '@aesyclaw/core/types';

/**
 * 获取当前配置。
 */
export function getConfig(deps: WebUiManagerDependencies): AppConfig {
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
 */
export function getConfigSchema(): typeof AppConfigSchema {
  return AppConfigSchema;
}

/**
 * 更新配置。
 */
export async function updateConfig(
  deps: WebUiManagerDependencies,
  body: DeepPartial<AppConfig>,
): Promise<void> {
  if (body.server !== undefined)
    await deps.configManager.patch('server', body.server as Record<string, unknown>);
  if (body.agent !== undefined)
    await deps.configManager.patch('agent', body.agent as Record<string, unknown>);
  if (body.providers !== undefined) await deps.configManager.set('providers', body.providers);
  if (body.channels !== undefined) await deps.configManager.set('channels', body.channels);
  if (body.mcp !== undefined) await deps.configManager.set('mcp', body.mcp);
  if (body.plugins !== undefined) await deps.configManager.set('plugins', body.plugins);
}
