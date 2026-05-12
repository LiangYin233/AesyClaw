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
import type { PluginHooks } from '@aesyclaw/pipeline/types';
import type { Logger } from '@aesyclaw/core/logger';
import type { PluginConfigEntry } from '@aesyclaw/core/config/schema';
import type { AesyClawTool } from '@aesyclaw/tool/tool-registry';
import type { ChannelPlugin } from '@aesyclaw/extension/channel/channel-types';
import type { ResolvedPaths } from '@aesyclaw/core/path-resolver';
import { isRecord } from '@aesyclaw/core/utils';
import { validateExtension } from '@aesyclaw/extension/extension-utils';

/** 插件初始化时接收的受限上下文。 */
export type PluginContext = {
  config: Record<string, unknown>;
  paths: Readonly<ResolvedPaths>;
  registerTool(tool: AesyClawTool): void;
  unregisterTool(name: string): void;
  registerCommand(command: CommandDefinition): void;
  registerChannel(channel: ChannelPlugin): void;
  logger: Logger;
};

/** 插件模块必须导出的定义结构。 */
export type PluginDefinition = {
  name: string;
  version: string;
  description?: string;
  defaultConfig?: Record<string, unknown>;
  init(ctx: PluginContext): Promise<void>;
  destroy?(): Promise<void>;
  hooks?: PluginHooks;
};

/** 内存中已加载插件的运行时表示。 */
export type LoadedPlugin = {
  definition: PluginDefinition;
  directory: string;
  directoryName: string;
  owner: ToolOwner;
  config: Record<string, unknown>;
  loadedAt: Date;
};

/** 插件生命周期的 4 种状态。 */
export type PluginLifecycleState = 'loaded' | 'disabled' | 'unloaded' | 'failed';

/** 前端查询单个插件时的状态快照。 */
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

/** 从磁盘加载完成后用于缓存的插件模块。 */
export type PluginModule = {
  definition: PluginDefinition;
  directory: string;
  directoryName: string;
  entryPath: string;
};

/** PluginManager 构造函数依赖项。 */
export type PluginManagerDependencies = {
  configManager: ConfigManager;
  toolRegistry: ToolRegistry;
  commandRegistry: CommandRegistry;
  hookRegistry: HookDispatcher;
  channelManager?: ChannelManager;
  paths: Readonly<ResolvedPaths>;
};

/** 从配置中查找插件启用/禁用状态和选项的结果。 */
export type PluginConfigLookup = {
  entry?: Readonly<PluginConfigEntry>;
  enabled: boolean;
  options: Record<string, unknown>;
};

export { type PluginHooks };

/**
 * 生成插件的所有权标识符。
 *
 * @param pluginName - 插件名称
 * @returns 格式为 "plugin:" + 插件名称的所有权字符串
 */
export function pluginOwner(pluginName: string): ToolOwner {
  return `plugin:${pluginName}`;
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
