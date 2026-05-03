/**
 * 插件接口定义。
 *
 * 插件是 `extensions/plugin_*` 下的外部模块，它们接收一个
 * 有作用域的上下文，并可以注册工具、命令和管道钩子。
 */

import type { CommandDefinition, ToolOwner } from '@aesyclaw/core/types';
import type { ConfigManager } from '@aesyclaw/core/config/config-manager';
import type { HookDispatcher } from '@aesyclaw/pipeline/hook-dispatcher';
import type { ToolRegistry } from '@aesyclaw/tool/tool-registry';
import type { CommandRegistry } from '@aesyclaw/command/command-registry';
import type { ChannelManager } from '@aesyclaw/extension/channel/channel-manager';
import type { PluginHooks } from '@aesyclaw/pipeline/middleware/types';
import type { Logger } from '@aesyclaw/core/logger';
import type { PluginConfigEntry } from '@aesyclaw/core/config/schema';
import type { AesyClawTool } from '@aesyclaw/tool/tool-registry';
import type { ChannelPlugin } from '@aesyclaw/extension/channel/channel-types';
import { isRecord } from '@aesyclaw/core/utils';
import { validateExtension } from '@aesyclaw/extension/extension-utils';

export type PluginContext = {
  config: Record<string, unknown>;
  registerTool(tool: AesyClawTool): void;
  unregisterTool(name: string): void;
  registerCommand(command: CommandDefinition): void;
  registerChannel(channel: ChannelPlugin): void;
  logger: Logger;
};

export type PluginDefinition = {
  name: string;
  version: string;
  description?: string;
  defaultConfig?: Record<string, unknown>;
  init(ctx: PluginContext): Promise<void>;
  destroy?(): Promise<void>;
  hooks?: PluginHooks;
};

export type LoadedPlugin = {
  definition: PluginDefinition;
  directory: string;
  directoryName: string;
  owner: ToolOwner;
  config: Record<string, unknown>;
  loadedAt: Date;
};

export type PluginLifecycleState = 'loaded' | 'disabled' | 'unloaded' | 'failed';

export type PluginStatus = {
  name: string;
  directoryName: string;
  version?: string;
  description?: string;
  enabled: boolean;
  state: PluginLifecycleState;
  directory: string;
  error?: string;
};

export type PluginModule = {
  definition: PluginDefinition;
  directory: string;
  directoryName: string;
  entryPath: string;
};

export type PluginManagerDependencies = {
  configManager: ConfigManager;
  toolRegistry: ToolRegistry;
  commandRegistry: CommandRegistry;
  hookRegistry: HookDispatcher;
  channelManager?: ChannelManager;
  extensionsDir?: string;
};

export type PluginConfigLookup = {
  entry?: Readonly<PluginConfigEntry>;
  enabled: boolean;
  options: Record<string, unknown>;
};

export { type PluginHooks };

export function pluginOwner(pluginName: string): ToolOwner {
  return `plugin:${pluginName}`;
}

/**
 * 校验未知值是否符合 PluginDefinition 结构。
 */
export function isPluginDefinition(value: unknown): value is PluginDefinition {
  return validateExtension<PluginDefinition>(value) !== false;
}

/**
 * 从动态导入的模块中发现并校验插件定义。
 *
 * 支持 default 或 plugin 命名导出。
 */
export function discoverPluginDefinition(imported: unknown): PluginDefinition | null {
  if (!isRecord(imported)) {
    return null;
  }

  const candidate = (imported['default'] ?? imported['plugin']) as unknown;
  if (candidate === null || candidate === undefined) return null;

  const result = validateExtension<PluginDefinition>(candidate);
  return result === false ? null : result;
}
