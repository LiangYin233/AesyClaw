import type { ConfigManager } from '@aesyclaw/core/config/config-manager';
import type { Logger } from '@aesyclaw/core/logger';
import { isRecord, mergeDefaults } from '@aesyclaw/core/utils';
import { stripEnabledField } from './extension-utils';
import type { BaseExtensionDefinition } from './types';

export type ExtensionConfigAccess = {
  configManager: ConfigManager;
  configKey: string;
};

export type ExtensionConfigWriteAccess = ExtensionConfigAccess & {
  extensionType: string;
  logger: Logger;
};

export function getBusinessDefaults<TDef extends BaseExtensionDefinition<unknown>>(
  definition: TDef,
): Record<string, unknown> {
  return stripEnabledField(definition.defaultConfig ?? {});
}

export function mergeExtensionConfig(
  managedDefaults: Record<string, unknown>,
  userConfig: Record<string, unknown>,
): Record<string, unknown> {
  return mergeDefaults(managedDefaults, userConfig);
}

export function getExtensionConfigRecord(access: ExtensionConfigAccess): Record<string, unknown> {
  try {
    const config = access.configManager.get(access.configKey);
    return isRecord(config) ? { ...config } : {};
  } catch {
    return {};
  }
}

export function getExtensionUserConfig(
  access: ExtensionConfigAccess,
  name: string,
): Record<string, unknown> {
  try {
    const configRecord = getExtensionConfigRecord(access);
    const raw = configRecord[name];
    return isRecord(raw) ? raw : {};
  } catch {
    return {};
  }
}

export function isExtensionConfigEnabled(config: Record<string, unknown>): boolean {
  return config['enabled'] !== false;
}

export function isExtensionDefinitionEnabled(access: ExtensionConfigAccess, name: string): boolean {
  try {
    const configRecord = getExtensionConfigRecord(access);
    const raw = configRecord[name];
    if (!isRecord(raw)) return true;
    return isExtensionConfigEnabled(raw);
  } catch {
    return true;
  }
}

export function hasExtensionConfigEntry(access: ExtensionConfigAccess, name: string): boolean {
  const record = getExtensionConfigRecord(access);
  return isRecord(record[name]);
}

export async function setExtensionEnabledConfig(
  access: ExtensionConfigAccess,
  name: string,
  enabled: boolean,
  managedDefaults: Record<string, unknown> | undefined,
): Promise<void> {
  const current = getExtensionUserConfig(access, name);
  const allConfig = getExtensionConfigRecord(access);
  const { enabled: _enabled, ...defaults } = managedDefaults ?? { enabled: undefined };
  allConfig[name] = {
    ...defaults,
    ...current,
    enabled,
  };
  await access.configManager.set(access.configKey, allConfig);
}

export async function writeDefaultExtensionConfig(
  access: ExtensionConfigWriteAccess,
  name: string,
  config: Record<string, unknown>,
): Promise<void> {
  const allConfig = getExtensionConfigRecord(access);
  allConfig[name] = { ...config };
  await access.configManager.set(access.configKey, allConfig).catch((err: unknown) => {
    access.logger.warn(`自动写入 ${access.extensionType} "${name}" 的配置条目失败`, err);
  });
}

export function extensionConfigsEqual(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  return JSON.stringify(sortConfigKeys(a)) === JSON.stringify(sortConfigKeys(b));
}

function sortConfigKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sortConfigKeys);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = sortConfigKeys((obj as Record<string, unknown>)[key]);
  }
  return sorted;
}
