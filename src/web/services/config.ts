/** 配置 Service。 */

import type { WebUiManagerDependencies } from '@aesyclaw/web/webui-manager';
import { AppConfigSchema, type AppConfig } from '@aesyclaw/core/config/schema';
import type { DeepPartial } from '@aesyclaw/core/types';

/**
 * 获取当前配置。
 */
export function getConfig(deps: WebUiManagerDependencies): AppConfig {
  return deps.configManager.getConfig() as AppConfig;
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
  await deps.configManager.update(body, {
    replaceTopLevelKeys: ['channels', 'plugins', 'providers'],
  });
}
