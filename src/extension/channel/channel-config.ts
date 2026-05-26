/**
 * channel-config — 频道的配置读取/写入逻辑。
 *
 * 从 ChannelManager 中提取，专注 channels 段的配置操作。
 */
import { isRecord, mergeDefaults } from '@aesyclaw/core/utils';
import { stripEnabledField } from '@aesyclaw/extension/extension-utils';
import type { ConfigManager } from '@aesyclaw/core/config/config-manager';
import { isChannelEnabled, type ChannelPlugin } from './channel-types';

export function getManagedChannelDefaults(channel: ChannelPlugin): Record<string, unknown> {
  return { enabled: false, ...stripEnabledField(channel.defaultConfig ?? {}) };
}

export function getMergedConfig(
  configManager: ConfigManager,
  definition: ChannelPlugin,
): Record<string, unknown> {
  const channelConfig = getConfigRecord(configManager, definition.name);
  return mergeDefaults(getManagedChannelDefaults(definition), channelConfig);
}

export function getConfigRecord(configManager: ConfigManager, channelName: string): Record<string, unknown> {
  try {
    const config = configManager.get(`channels.${channelName}`);
    return isRecord(config) ? config : {};
  } catch {
    return {};
  }
}

export function isEnabled(
  configManager: ConfigManager,
  definitions: Map<string, ChannelPlugin>,
  channelName: string,
): boolean {
  const definition = definitions.get(channelName);
  const config = definition
    ? getMergedConfig(configManager, definition)
    : getConfigRecord(configManager, channelName);
  return isChannelEnabled(config);
}

export function getAllConfigRecords(configManager: ConfigManager): Record<string, unknown> {
  try {
    const config = configManager.get('channels');
    return isRecord(config) ? { ...config } : {};
  } catch {
    return {};
  }
}

export async function setChannelEnabled(
  configManager: ConfigManager,
  definitions: Map<string, ChannelPlugin>,
  channelName: string,
  enabled: boolean,
): Promise<void> {
  const definition = definitions.get(channelName);
  const current = getConfigRecord(configManager, channelName);
  const channels = getAllConfigRecords(configManager);
  const { enabled: _enabled, ...defaults } = definition
    ? getManagedChannelDefaults(definition)
    : {};
  channels[channelName] = {
    ...defaults,
    ...current,
    enabled,
  };
  await configManager.set('channels', channels);
}
