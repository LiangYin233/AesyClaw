/**
 * 插件接口定义。
 *
 * 插件是 `extensions/plugin_*` 下的外部模块，它们接收一个
 * 有作用域的上下文，并可以注册工具、命令和管道钩子。
 */

import type { CommandDefinition } from '../../core/types';
import type { Logger } from '../../core/logger';
import type { PluginConfigEntry } from '../../core/config/schema';
import type { AesyClawTool } from '../../tool/tool-registry';
import type { ToolRegistry } from '../../tool/tool-registry';
import type { CommandRegistry } from '../../command/command-registry';
import type { ChannelPlugin } from '../channel/channel-types';
import type { ChannelManager } from '../channel/channel-manager';
import type { HookDispatcher } from '../../pipeline/hook-dispatcher';
import type { PluginHooks } from '../../pipeline/middleware/types';
import type { PluginLoader } from './plugin-loader';
import type { ConfigManager } from '../../core/config/config-manager';
import { isRecord } from '../../core/utils';

export type PluginOwner = `plugin:${string}`;

export type PluginContext = {
  config: Record<string, unknown>;
  registerTool(tool: AesyClawTool): void;
  unregisterTool(name: string): void;
  registerCommand(command: CommandDefinition): void;
  registerChannel(channel: ChannelPlugin): void;
  logger: Logger;
}

export type PluginDefinition = {
  name: string;
  version: string;
  description?: string;
  defaultConfig?: Record<string, unknown>;
  init(ctx: PluginContext): Promise<void>;
  destroy?(): Promise<void>;
  hooks?: PluginHooks;
}

export type LoadedPlugin = {
  definition: PluginDefinition;
  directory: string;
  directoryName: string;
  owner: PluginOwner;
  config: Record<string, unknown>;
  loadedAt: Date;
}

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
}

export type PluginModule = {
  definition: PluginDefinition;
  directory: string;
  directoryName: string;
  entryPath: string;
}

export type PluginLoaderOptions = {
  extensionsDir?: string;
}

export type PluginManagerDependencies = {
  configManager: ConfigManager;
  toolRegistry: ToolRegistry;
  commandRegistry: CommandRegistry;
  hookRegistry: HookDispatcher;
  channelManager?: ChannelManager;
  pluginLoader?: PluginLoader;
}

export type PluginConfigLookup = {
  entry?: Readonly<PluginConfigEntry>;
  enabled: boolean;
  options: Record<string, unknown>;
}

export { type PluginHooks };

export function pluginOwner(pluginName: string): PluginOwner {
  return `plugin:${pluginName}`;
}

export function isPluginDefinition(value: unknown): value is PluginDefinition {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.name === 'string' &&
    value.name.length > 0 &&
    typeof value.version === 'string' &&
    value.version.length > 0 &&
    typeof value.init === 'function' &&
    (value.destroy === undefined || typeof value.destroy === 'function') &&
    (value.description === undefined || typeof value.description === 'string') &&
    (value.defaultConfig === undefined || isRecord(value.defaultConfig))
  );
}
