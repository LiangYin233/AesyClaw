/**
 * config — 插件的配置读取/写入逻辑。
 */
import { isRecord } from '@aesyclaw/core/utils';
import { stripEnabledField } from '@aesyclaw/extension/extension-utils';
import type { PluginModule } from './types';

export function getPluginConfig(
  definitions: Record<string, unknown>,
  module: PluginModule,
): { exists: boolean; enabled: boolean; config: Record<string, unknown> } {
  const raw = definitions[module.definition.name];
  const entry = isRecord(raw) ? raw : null;
  return {
    exists: entry !== null,
    enabled: entry?.['enabled'] !== false,
    config: entry ? stripEnabledField(entry) : {},
  };
}
