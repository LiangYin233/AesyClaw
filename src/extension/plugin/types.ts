import type { TSchema } from '@sinclair/typebox';
/**
 * 插件接口定义。
 *
 * 插件是 `extensions/plugin_*` 下的外部模块，它们接收一个
 * 有作用域的上下文，并可以注册工具、命令和管道钩子。
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
import {
  validateExtension,
  discoverExtensionDefinition,
} from '@aesyclaw/extension/extension-utils';
/** 插件初始化时接收的受限上下文。 */
export type PluginContext = {
  /** 插件名称 */
  name: string;
  config: Record<string, unknown>;
  /** 运行时状态容器（框架自动管理生命周期，unload 时清空） */
  state: Record<string, unknown>;
  paths: Readonly<ResolvedPaths>;
  configManager: ConfigManager;
  registerTool(tool: AesyClawTool): void;
  unregisterTool(name: string): void;
  registerCommand(command: Omit<CommandDefinition, 'scope'>): void;
  logger: Logger;
  /** 根据 "provider/model" 标识符解析完整的模型配置（含 API 密钥、baseUrl 等） */
  resolveModel(providerModel: string): ResolvedModel;
};
/** 插件模块必须导出的定义结构。 */
export type PluginDefinition = {
  name: string;
  version: string;
  description?: string;
  defaultConfig?: Record<string, unknown>;
  /** 配置的 TypeBox Schema（提供后框架在 load() 时自动校验并填充默认值） */
  configSchema?: TSchema;
  init(ctx: PluginContext): Promise<void>;
  destroy?(): Promise<void>;
  /** 健康检查（可选），返回健康状况和延迟 */
  healthCheck?(): Promise<PluginHealthStatus>;
  middlewares?: HookRegistration[];
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
export function isPluginDefinition(value: unknown): value is PluginDefinition {
  const validated = validateExtension<PluginDefinition>(value);
  if (validated === false) return false;
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
