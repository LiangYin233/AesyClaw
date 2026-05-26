/**
 * plugin-config — 插件的配置读取/写入逻辑。
 *
 * 从 PluginManager 中提取，专注 plugins 段的配置操作。
 */
import { isRecord } from '@aesyclaw/core/utils';
import type { ConfigManager } from '@aesyclaw/core/config/config-manager';
import type { PluginModule } from './plugin-types';

export type ConfigDeps = {
  configManager: ConfigManager;
};

export function getPluginConfig(
  deps: ConfigDeps,
  definitions: Record<string, unknown>,
  module: PluginModule,
): { exists: boolean; enabled: boolean; config: Record<string, unknown> } {
  const raw = definitions[module.definition.name] ?? definitions[module.directoryName];
  const entry = isRecord(raw) ? raw : null;
  return {
    exists: entry !== null,
    enabled: entry?.['enabled'] !== false,
    config: entry ? stripRecordEnabled(entry) : {},
  };
}

export function isDirectoryEnabled(deps: ConfigDeps, directoryName: string): boolean {
  const raw = getPluginRecord(deps)[directoryName];
  const entry = isRecord(raw) ? raw : null;
  return entry?.['enabled'] !== false;
}

export function getPluginRecord(deps: ConfigDeps): Record<string, unknown> {
  try {
    const plugins = deps.configManager.get('plugins');
    return isRecord(plugins) ? plugins : {};
  } catch {
    return {};
  }
}

export async function setPluginEnabled(
  deps: ConfigDeps,
  pluginName: string,
  canonicalName: string,
  directoryName: string,
  enabled: boolean,
): Promise<void> {
  const plugins = getPluginRecord(deps);
  const existing: Record<string, unknown> | undefined =
    (plugins[canonicalName] ?? plugins[directoryName]) as Record<string, unknown> | undefined;
  if (existing) {
    existing['enabled'] = enabled;
  } else {
    plugins[canonicalName] = { enabled } as Record<string, unknown>;
  }
  await deps.configManager.set('plugins', plugins);
}

function stripRecordEnabled(value: Record<string, unknown>): Record<string, unknown> {
  const { enabled: _enabled, ...rest } = value;
  return rest;
}
