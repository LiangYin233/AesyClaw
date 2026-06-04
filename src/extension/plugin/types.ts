import type { TSchema } from '@sinclair/typebox';
/**
 * 插件接口定义。
 *
 * 插件是 `extensions/plugin_*` 下的外部模块，它们接收一个
 * 命名空间化的上下文，并可以注册工具、命令和管道钩子。
 */

import type { CommandDefinition, ToolOwner } from '@aesyclaw/core/types';
import type { ExtensionHealthStatus, ExtensionLifecycleState } from '@aesyclaw/extension/types';
import type { LlmAdapter } from '@aesyclaw/agent/llm/adapter';
import type { ConfigManager } from '@aesyclaw/core/config/config-manager';
import type { IHooksBus, HookRegistration } from '@aesyclaw/hook';
import type { CommandRegistry } from '@aesyclaw/command/command-registry';
import type { Logger } from '@aesyclaw/core/logger';
import type { AesyClawTool, ToolRegistry } from '@aesyclaw/tool/tool-registry';
import type { ResolvedPaths } from '@aesyclaw/core/path-resolver';
import type { ResolvedModel } from '@aesyclaw/contracts/llm';
import type { RuntimeControlApi } from './control';
import {
  validateExtension,
  discoverExtensionDefinition,
} from '@aesyclaw/extension/extension-utils';

export type PluginConfigPermissions = {
  read?: string[];
  write?: string[];
};

export type PluginPermissions = {
  config?: PluginConfigPermissions;
};

export type PluginMetaApi = {
  name: string;
  owner: ToolOwner;
  directoryName: string;
};

export type PluginPathsApi = Pick<
  ResolvedPaths,
  'runtimeRoot' | 'dataDir' | 'mediaDir' | 'workspaceDir'
> & {
  pluginDir: string;
};

export type PluginConfigNamespace = {
  get<T = unknown>(path: string): T | undefined;
  set(path: string, value: unknown): Promise<void>;
};

export type PluginGlobalConfigNamespace = PluginConfigNamespace & {
  update(update: Record<string, unknown>): Promise<void>;
};

export type PluginConfigApi = {
  self: PluginConfigNamespace;
  global: PluginGlobalConfigNamespace;
};

export type PluginRegistryApi = {
  tools: {
    register(tool: Omit<AesyClawTool, 'owner'> | AesyClawTool): void;
  };
  commands: {
    register(command: Omit<CommandDefinition, 'scope'>): void;
  };
};

export type PluginHookRegistration = HookRegistration;

export type PluginHooksApi = {
  register(registration: PluginHookRegistration): void;
  unregister(id: string): void;
};

export type PluginModelDto = {
  id: string;
  provider: string;
  model: string;
};

export type PluginModelApi = {
  resolve(providerModel: string): ResolvedModel;
  list(): Promise<PluginModelDto[]>;
};

/** 插件初始化时接收的受限上下文。 */
export type PluginContext = {
  meta: PluginMetaApi;
  log: Logger;
  paths: PluginPathsApi;
  config: PluginConfigApi;
  registry: PluginRegistryApi;
  hooks: PluginHooksApi;
  models: PluginModelApi;
  control: RuntimeControlApi;
};

/** 插件模块必须导出的定义结构。 */
export type PluginDefinition = {
  name: string;
  version: string;
  description?: string;
  /** 配置的 TypeBox Schema（提供后框架在 load() 时自动校验并填充默认值） */
  configSchema?: TSchema;
  permissions?: PluginPermissions;
  init(ctx: PluginContext): Promise<void>;
  destroy?(ctx: PluginContext): Promise<void>;
  /** 健康检查（可选），返回健康状况和延迟 */
  healthCheck?(): Promise<PluginHealthStatus>;
};

/** 插件健康检查结果。 */
export type PluginHealthStatus = ExtensionHealthStatus;

/** 插件生命周期的 4 种状态。 */
export type PluginLifecycleState = ExtensionLifecycleState;

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
  llmAdapter: Pick<LlmAdapter, 'resolveModel'>;
  hooksBus: IHooksBus;
  paths: Readonly<ResolvedPaths>;
  control: RuntimeControlApi;
};

export type { HookRegistration };

/**
 * 生成插件的所有权标识符。
 *
 * @param pluginName - 插件名称
 * @returns 格式为 "plugin:" + 插件名称的所有权字符串
 */
export function pluginOwner(pluginName: string): ToolOwner {
  return `plugin:${pluginName}`;
}
/** 校验未知值是否符合 PluginDefinition 结构。 */
function isPluginDefinition(value: unknown): value is PluginDefinition {
  const validated = validateExtension<PluginDefinition & Record<string, unknown>>(value);
  if (validated === false) return false;
  // 破坏式重构：插件不再支持 defaultConfig / middlewares。
  // defaultConfig 仍保留在通用扩展校验中供 channel 使用，因此在插件层显式拒绝。
  if (validated['defaultConfig'] !== undefined || validated['middlewares'] !== undefined) {
    return false;
  }
  return true;
}

/**
 * 从动态导入的模块中发现并校验插件定义。
 *
 * 支持 default 或 plugin 命名导出。
 */
export function discoverPluginDefinition(imported: unknown): PluginDefinition | null {
  const base = discoverExtensionDefinition(imported, 'plugin');
  if (!base) return null;
  return isPluginDefinition(base) ? base : null;
}
