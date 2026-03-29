import type { InboundMessage, OutboundMessage, PluginErrorContext } from '../../types.js';
import type { ToolContext } from '../tools/ToolRegistry.js';

export interface ToolBeforePayload {
  toolName: string;
  params: Record<string, any>;
  context?: ToolContext;
}

export interface ToolAfterPayload {
  toolName: string;
  params: Record<string, any>;
  result: string;
  context?: ToolContext;
}

export interface AgentBeforePayload {
  message: InboundMessage;
  messages: unknown[];
}

export interface AgentAfterPayload {
  message: InboundMessage;
  response: unknown;
}

export interface PluginErrorPayload {
  error: Error;
  context: PluginErrorContext;
}

export type PluginOptions = Record<string, any>;

export interface PluginDefaultConfig<TOptions extends PluginOptions = PluginOptions> {
  enabled?: boolean;
  options?: TOptions;
}

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

export interface PluginsService {
  listPlugins(): Promise<{ plugins: PluginInfo[] }>;
  togglePlugin(name: string, enabled: boolean): Promise<{ success: true }>;
}

export interface PluginContext {
  pluginManager: PluginManager | undefined;
  pluginsService: PluginsService | undefined;
}
