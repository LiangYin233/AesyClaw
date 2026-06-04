import type { TSchema } from '@sinclair/typebox';
import type { IHooksBus } from '@aesyclaw/hook';
/** 频道接口定义。 */

import type {
  CommandDefinition,
  Message,
  OutboundSignal,
  SessionKey,
  SenderInfo,
} from '@aesyclaw/core/types';
import type { Logger } from '@aesyclaw/core/logger';
import type { ConfigManager } from '@aesyclaw/core/config/config-manager';
import type { Pipeline } from '@aesyclaw/pipeline/pipeline';
import type { ResolvedPaths } from '@aesyclaw/core/path-resolver';
import type {
  LoadedExtension,
  ExtensionHealthStatus,
  ExtensionLifecycleState,
} from '@aesyclaw/extension/types';
import type { ToolRegistry, AesyClawTool } from '@aesyclaw/tool/tool-registry';
import type { CommandRegistry } from '@aesyclaw/command/command-registry';
import type { SessionSummary, SessionMessageDto, SessionManager } from '@aesyclaw/session';
import type { DatabaseManager } from '@aesyclaw/core/database/database-manager';

import type { LlmAdapter } from '@aesyclaw/agent/llm/adapter';
import type { ResolvedModel } from '@aesyclaw/contracts/llm';

import {
  validateExtension,
  discoverExtensionDefinition,
} from '@aesyclaw/extension/extension-utils';

export type RegisteredCommandInfo = Omit<CommandDefinition, 'execute'>;

export type ChannelMessageApi = {
  receive(message: Message, sessionKey: SessionKey, sender?: SenderInfo): Promise<void>;
  getCommands(): RegisteredCommandInfo[];
};

export type ChannelRegistryApi = {
  tools: {
    register(tool: AesyClawTool): void;
    unregister(name: string): void;
  };
  commands: {
    register(command: Omit<CommandDefinition, 'scope'>): void;
  };
};

export type ChannelSessionApi = {
  /** 获取指定会话的上下文窗口使用率。 */
  getContextUsage(
    sessionKey: SessionKey,
  ): Promise<{ inputTokens: number; outputTokens: number; contextWindow: number }>;
  /** 获取指定会话绑定的模型和角色 ID。 */
  getModel(sessionKey: SessionKey): Promise<{ modelId?: string; roleId?: string }>;
  /** 获取所有会话列表（用于 Desktop 同步）。 */
  list(): Promise<SessionSummary[]>;
  /** 获取指定会话的消息历史。 */
  getMessages(sessionKey: SessionKey): Promise<SessionMessageDto[]>;
};

export type ChannelModelApi = {
  /** 根据 "provider/model" 标识符解析完整的模型配置（含 API 密钥、baseUrl 等）。 */
  resolve(providerModel: string): ResolvedModel;
};

/** 频道初始化时接收的上下文（公共能力 + channel 专属命名空间）。 */
export type ChannelContext = {
  name: string;
  config: Record<string, unknown>;
  configManager: ConfigManager;
  paths: Readonly<ResolvedPaths>;
  logger: Logger;
  /** 运行时状态容器（框架自动管理生命周期，stop 时清空） */
  state: Record<string, unknown>;
  channel: ChannelMessageApi;
  sessions: ChannelSessionApi;
  models: ChannelModelApi;
  registry: ChannelRegistryApi;
};

export type ChannelPlugin = {
  name: string;
  version: string;
  description?: string;
  defaultConfig?: Record<string, unknown>;
  /** 配置的 TypeBox Schema（提供后框架在 start() 时自动校验并填充默认值） */
  configSchema?: TSchema;
  streaming: boolean;
  init(ctx: ChannelContext): Promise<void>;
  destroy?(): Promise<void>;
  send(signal: OutboundSignal): Promise<void>;
  /** 健康检查（可选），返回健康状况和延迟 */
  healthCheck?(): Promise<ChannelHealthStatus>;
};

/** 已加载频道的运行时状态（LoadedExtension 的子集）。 */
export type LoadedChannel = Omit<
  LoadedExtension<ChannelPlugin, ChannelContext>,
  'context' | 'owner'
>;

/** 频道生命周期的 4 种状态。 */
export type ChannelLifecycleState = ExtensionLifecycleState;

/** 前端查询单个频道时的状态快照。 */
export type ChannelStatus = {
  name: string;
  version?: string;
  description?: string;
  enabled: boolean;
  state: ChannelLifecycleState;
  error?: string;
};

/** ChannelManager 构造函数依赖项。 */
export type ChannelManagerDependencies = {
  configManager: ConfigManager;
  pipeline: Pipeline;
  hooksBus: IHooksBus;
  channels?: ChannelPlugin[];
  paths: Readonly<ResolvedPaths>;
  toolRegistry: ToolRegistry;
  commandRegistry: CommandRegistry;
  sessionManager: SessionManager;
  llmAdapter: Pick<LlmAdapter, 'resolveModel'>;
  databaseManager: Pick<DatabaseManager, 'sessions' | 'usage'>;
};

/**
 * 校验未知值是否符合 ChannelPlugin 结构。
 */
export function isChannelPlugin(value: unknown): value is ChannelPlugin {
  const validated = validateExtension<ChannelPlugin>(value);
  if (validated === false) return false;
  if (typeof validated['send'] !== 'function') return false;
  return true;
}

/**
 * 从动态导入的模块中发现并校验频道定义。
 *
 * 支持静态 `default` 或 `channel` 导出。
 */
export function discoverChannelDefinition(imported: unknown): ChannelPlugin | null {
  const base = discoverExtensionDefinition(imported, 'channel');
  if (!base) return null;
  return isChannelPlugin(base) ? base : null;
}

export type ChannelHealthStatus = ExtensionHealthStatus;
