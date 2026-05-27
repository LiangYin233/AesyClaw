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
import type { MessageProcessor } from '@aesyclaw/contracts/pipeline';
import type { ResolvedPaths } from '@aesyclaw/core/path-resolver';
import type { ToolRegistry, AesyClawTool } from '@aesyclaw/tool/tool-registry';
import type { CommandRegistry } from '@aesyclaw/command/command-registry';
import type { Session } from '@aesyclaw/session/core';
import type { LlmAdapter } from '@aesyclaw/agent/llm/adapter';

import {
  validateExtension,
  discoverExtensionDefinition,
} from '@aesyclaw/extension/extension-utils';

export type RegisteredCommandInfo = Omit<CommandDefinition, 'execute'>;

/** 频道初始化时接收的上下文（包含名称、配置、接收回调等）。 */
export type ChannelContext = {
  name: string;
  config: Record<string, unknown>;
  configManager: ConfigManager;
  paths: Readonly<ResolvedPaths>;
  receive(message: Message, sessionKey: SessionKey, sender?: SenderInfo): Promise<void>;
  registerTool(tool: AesyClawTool): void;
  unregisterTool(name: string): void;
  registerCommand(command: Omit<CommandDefinition, 'scope'>): void;
  getCommands(): RegisteredCommandInfo[];
  logger: Logger;
  /**
   * 获取指定会话的上下文窗口使用率。
   * 返回估算 token 数、模型上下文窗口大小、占用百分比。
   * 若会话不存在或无法确定模型，contextWindow/percentage 可能为 0。
   */
  getSessionContextUsage(
    sessionKey: SessionKey,
  ): Promise<{ estimatedTokens: number; contextWindow: number; percentage: number }>;
  /** 获取所有会话列表（用于 Desktop 同步） */
  getSessions(): Promise<
    Array<{
      id: string;
      channel: string;
      type: string;
      chatId: string;
      title: string;
      firstUserMessage?: string;
      messageCount?: number;
      lastActivity?: string;
    }>
  >;
  /** 获取指定会话的消息历史 */
  getSessionMessages(
    sessionKey: SessionKey,
  ): Promise<Array<{ role: string; content: string; timestamp?: string; toolData?: string }>>;
};

export type ChannelPlugin = {
  name: string;
  version: string;
  description?: string;
  defaultConfig?: Record<string, unknown>;
  streaming: boolean;
  init(ctx: ChannelContext): Promise<void>;
  destroy?(): Promise<void>;
  receive(message: Message, sessionKey: SessionKey, sender?: SenderInfo): Promise<void>;
  send(signal: OutboundSignal): Promise<void>;
};

/** 内存中已加载频道的运行时表示。 */
export type LoadedChannel = {
  definition: ChannelPlugin;
  config: Record<string, unknown>;
  loadedAt: Date;
};

/** 频道生命周期的 4 种状态。 */
export type ChannelLifecycleState = 'loaded' | 'disabled' | 'unloaded' | 'failed';

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
  pipeline: MessageProcessor;
  hooksBus: IHooksBus;
  channels?: ChannelPlugin[];
  paths: Readonly<ResolvedPaths>;
  toolRegistry: ToolRegistry;
  commandRegistry: CommandRegistry;
  sessionManager: {
    get(key: SessionKey): Session | undefined;
    create(key: SessionKey): Promise<Session>;
  };
  llmAdapter: Pick<LlmAdapter, 'resolveModel'>;
  databaseManager: {
    sessions: {
      findAllSummaries(): Promise<
        Array<{ id: string; channel: string; type: string; chatId: string; lastActivity?: string; firstUserMessage?: string; messageCount: number }>
      >;
      findById(id: string): Promise<{ id: string; channel: string; type: string; chatId: string } | null>;
    };
    messages: {
      loadHistory(sessionId: string): Promise<Array<{ role: string; content: string; timestamp?: string; toolData?: string }>>;
    };
  };
};

/** 从磁盘加载完成后的频道模块。 */
export type ChannelModule = {
  definition: ChannelPlugin;
  directory: string;
  directoryName: string;
  entryPath: string;
};

/**
 * 检查频道配置是否已启用。
 *
 * @param config - 频道配置对象
 * @returns 如果 enabled 不为 false 则返回 true
 */
export function isChannelEnabled(config: Record<string, unknown> | undefined): boolean {
  return config?.['enabled'] !== false;
}

/**
 * 校验未知值是否符合 ChannelPlugin 结构。
 */
export function isChannelPlugin(value: unknown): value is ChannelPlugin {
  const validated = validateExtension<ChannelPlugin>(value);
  if (validated === false) return false;
  if (typeof validated['receive'] !== 'function') return false;
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
