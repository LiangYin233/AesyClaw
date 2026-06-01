/**
 * Extension 系统的基础类型定义。
 *
 * 定义 Plugin 和 Channel 共享的接口契约，
 * 为泛型基类 BaseExtensionManager 提供类型约束。
 */

import type { TSchema } from '@sinclair/typebox';
import type { Logger } from '@aesyclaw/core/logger';
import type { ResolvedPaths } from '@aesyclaw/core/path-resolver';
import type { AesyClawTool } from '@aesyclaw/tool/tool-registry';
import type { CommandDefinition, ToolOwner } from '@aesyclaw/core/types';
import type { ConfigManager } from '@aesyclaw/core/config/config-manager';
import type { ResolvedModel } from '@aesyclaw/contracts/llm';

// ─── 扩展健康检查结果 ─────────────────────────────────────────

export type ExtensionHealthStatus = {
  ok: boolean;
  error?: string;
  latencyMs?: number;
};

// ─── 扩展生命周期状态 ─────────────────────────────────────────

export type ExtensionLifecycleState = 'loaded' | 'disabled' | 'unloaded' | 'failed';

// ─── 基础扩展定义接口 ─────────────────────────────────────────

/**
 * 所有扩展（Plugin/Channel）必须实现的基础定义结构。
 *
 * @template TCtx - 扩展上下文类型（PluginContext 或 ChannelContext）
 */
export type BaseExtensionDefinition<TCtx> = {
  name: string;
  version: string;
  description?: string;
  defaultConfig?: Record<string, unknown>;
  /** 配置的 TypeBox Schema（提供后框架在 load() 时自动校验并填充默认值） */
  configSchema?: TSchema;
  init(ctx: TCtx): void | Promise<void>;
  destroy?(): void | Promise<void>;
  healthCheck?(): Promise<ExtensionHealthStatus>;
};

// ─── 基础扩展上下文接口 ───────────────────────────────────────

/**
 * 所有扩展上下文（PluginContext/ChannelContext）共享的基础能力。
 */
export type BaseExtensionContext = {
  /** 扩展名称 */
  name: string;
  /** 扩展配置（getter，指向最新的合并配置） */
  readonly config: Record<string, unknown>;
  /** 运行时状态容器（框架自动管理生命周期，卸载时清空） */
  state: Record<string, unknown>;
  /** 路径解析器 */
  paths: Readonly<ResolvedPaths>;
  /** 配置管理器 */
  configManager: ConfigManager;
  /** 带作用域的 Logger */
  logger: Logger;
  /** 根据 "provider/model" 标识符解析完整的模型配置 */
  resolveModel(providerModel: string): ResolvedModel;
  /** 注册工具，作用域自动限定 */
  registerTool(tool: AesyClawTool): void;
  /** 注销已注册的工具（只能注销自己的） */
  unregisterTool(name: string): void;
  /** 注册斜杠命令，作用域自动限定 */
  registerCommand(command: Omit<CommandDefinition, 'scope'>): void;
};

// ─── 已加载扩展的运行时表示 ───────────────────────────────────

export type LoadedExtension<TDef, TCtx> = {
  definition: TDef;
  config: Record<string, unknown>;
  context: TCtx;
  loadedAt: Date;
  owner: ToolOwner;
  /** 扩展运行时状态容器 */
  state: Record<string, unknown>;
};

// ─── 扩展状态快照 ─────────────────────────────────────────────

export type ExtensionStatus = {
  name: string;
  directoryName?: string;
  version?: string;
  description?: string;
  enabled: boolean;
  state: ExtensionLifecycleState;
  error?: string;
};
