/**
 * 插件上下文类型定义
 * 
 * 为其他模块提供插件系统的类型接口
 */

import type { InboundMessage, OutboundMessage, PluginErrorContext } from '../../types.js';
import type { ToolContext } from '../tools/ToolRegistry.js';

/** 工具调用前负载 */
export interface ToolBeforePayload {
  toolName: string;
  params: Record<string, any>;
  context?: ToolContext;
}

/** 工具调用后负载 */
export interface ToolAfterPayload {
  toolName: string;
  params: Record<string, any>;
  result: string;
  context?: ToolContext;
}

/** Agent 开始前负载 */
export interface AgentBeforePayload {
  message: InboundMessage;
  messages: unknown[];
}

/** Agent 完成后负载 */
export interface AgentAfterPayload {
  message: InboundMessage;
  response: unknown;
}

/** 插件错误负载 */
export interface PluginErrorPayload {
  error: Error;
  context: PluginErrorContext;
}

/** 插件选项（旧版兼容） */
export type PluginOptions = Record<string, any>;

/** 插件默认配置（旧版兼容） */
export interface PluginDefaultConfig<TOptions extends PluginOptions = PluginOptions> {
  enabled?: boolean;
  options?: TOptions;
}

/** 插件信息（旧版兼容） */
export interface PluginInfo {
  name: string;
  version: string;
  description?: string;
  author?: string;
  enabled: boolean;
  options?: PluginOptions;
  defaultConfig?: PluginDefaultConfig;
  toolsCount: number;
  kind?: 'plugin' | 'channel';
  channelName?: string;
  running?: boolean;
}

/** 插件管理器接口 */
export interface PluginManager {
  runAgentBeforeTaps(input: AgentBeforePayload): Promise<void>;
  runAgentAfterTaps(input: AgentAfterPayload): Promise<void>;
  runToolBeforeHooks(input: ToolBeforePayload): Promise<{ params: Record<string, any>; context?: ToolContext }>;
  runToolAfterHooks(input: ToolAfterPayload): Promise<{ result: string }>;
  runErrorTaps(error: unknown, context: PluginErrorContext): Promise<void>;
  dispatchMessage(message: OutboundMessage, options?: { skipHooks?: boolean }): Promise<void>;
  runCommands(message: InboundMessage): Promise<{ type: 'reply'; message: InboundMessage } | { type: 'handled' } | null>;
  runMessageInHooks(message: InboundMessage): Promise<InboundMessage | null>;
}

/** 插件服务接口 */
export interface PluginsService {
  listPlugins(): Promise<{ plugins: PluginInfo[] }>;
  togglePlugin(name: string, enabled: boolean): Promise<{ success: true }>;
}

/** 插件上下文（旧版兼容） */
export interface PluginContext {
  pluginManager: PluginManager | undefined;
  pluginsService: PluginsService | undefined;
}
