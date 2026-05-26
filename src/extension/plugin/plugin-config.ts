/**
 * plugin-config — 插件的配置读取/写入逻辑。
 */
import { isRecord } from '@aesyclaw/core/utils';
import { stripEnabledField } from '@aesyclaw/extension/extension-utils';
import type { ConfigManager } from '@aesyclaw/core/config/config-manager';
import type { PluginModule } from './plugin-types';

export function getPluginConfig(
  definitions: Record<string, unknown>,
  module: PluginModule,
): { exists: boolean; enabled: boolean; config: Record<string, unknown> } {
  const raw = definitions[module.definition.name] ?? definitions[module.directoryName];
  const entry = isRecord(raw) ? raw : null;
  return {
    exists: entry !== null,
    enabled: entry?.['enabled'] !== false,
    config: entry ? stripEnabledField(entry) : {},
  };
}

export function isDirectoryEnabled(configManager: ConfigManager, directoryName: string): boolean {
  const raw = getPluginRecord(configManager)[directoryName];
  const entry = isRecord(raw) ? raw : null;
  return entry?.['enabled'] !== false;
}

export function getPluginRecord(configManager: ConfigManager): Record<string, unknown> {
  try {
    const plugins = configManager.get('plugins');
    return isRecord(plugins) ? plugins : {};
  } catch {
    return {};
  }
}

export async function setPluginEnabled(
  configManager: ConfigManager,
  pluginName: string,
  canonicalName: string,
  directoryName: string,
  enabled: boolean,
): Promise<void> {
  const plugins = getPluginRecord(configManager);
  const existing: Record<string, unknown> | undefined = (plugins[canonicalName] ??
    plugins[directoryName]) as Record<string, unknown> | undefined;
  if (existing) {
    existing['enabled'] = enabled;
  } else {
    plugins[canonicalName] = { enabled } as Record<string, unknown>;
  }
  await configManager.set('plugins', plugins);
}
