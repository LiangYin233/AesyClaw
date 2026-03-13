import type { Logger } from '../logger/index.js';
import type { Tool, ToolContext, ToolRegistry } from '../tools/ToolRegistry.js';
import type { Config, InboundMessage, LLMMessage, LLMResponse, OutboundMessage, PluginErrorContext } from '../types.js';

export type PluginOptions = Record<string, any>;

export interface PluginDefaultConfig<TOptions extends PluginOptions = PluginOptions> {
  enabled?: boolean;
  options?: TOptions;
}

export type CommandMatcher =
  | { type: 'regex'; value: RegExp }
  | { type: 'prefix'; value: string }
  | { type: 'exact'; value: string }
  | { type: 'contains'; value: string };

export interface PluginCommand<TMessage extends InboundMessage = InboundMessage> {
  name: string;
  description: string;
  matcher?: CommandMatcher;
  execute: (message: TMessage, args: string[]) => Promise<TMessage | null | void> | TMessage | null | void;
}

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
  messages: LLMMessage[];
}

export interface AgentAfterPayload {
  message: InboundMessage;
  response: LLMResponse;
}

export interface PluginErrorPayload {
  error: Error;
  context: PluginErrorContext;
}

export type MessageTransformHandler<T> = (value: T) => Promise<T | null> | T | null;
export type TapHandler<T> = (value: T) => Promise<void> | void;

export interface HookRegistrationApi<T> {
  transform(handler: MessageTransformHandler<T>): void;
}

export interface TapRegistrationApi<T> {
  tap(handler: TapHandler<T>): void;
}

export interface PluginHooks {
  messageIn: HookRegistrationApi<InboundMessage>;
  messageOut: HookRegistrationApi<OutboundMessage>;
  toolBefore: HookRegistrationApi<ToolBeforePayload>;
  toolAfter: HookRegistrationApi<ToolAfterPayload>;
  agentBefore: TapRegistrationApi<AgentBeforePayload>;
  agentAfter: TapRegistrationApi<AgentAfterPayload>;
  error: TapRegistrationApi<PluginErrorPayload>;
}

export interface PluginToolRegistryApi {
  register(tool: Tool): void;
}

export interface PluginCommandRegistryApi {
  register(command: PluginCommand): void;
}

export interface SendMessageOptions {
  skipHooks?: boolean;
}

export interface PluginContext<TOptions extends PluginOptions = PluginOptions> {
  config: Readonly<Config>;
  options: Readonly<TOptions>;
  workspace: string;
  tempDir: string;
  logger: Logger;
  sendMessage(message: OutboundMessage, options?: SendMessageOptions): Promise<void>;
  tools: PluginToolRegistryApi;
  commands: PluginCommandRegistryApi;
  hooks: PluginHooks;
}

export type PluginTeardown = () => Promise<void> | void;

export interface PluginDefinition<TOptions extends PluginOptions = PluginOptions> {
  name: string;
  version: string;
  description?: string;
  author?: string;
  defaultConfig?: PluginDefaultConfig<TOptions>;
  toolsCount?: number;
  setup(context: PluginContext<TOptions>): Promise<void | PluginTeardown> | void | PluginTeardown;
}

export type Plugin = PluginDefinition;

export interface PluginConfigState {
  enabled: boolean;
  options?: PluginOptions;
}

export type PluginCommandExecutionResult =
  | { type: 'reply'; message: InboundMessage }
  | { type: 'handled' };

export interface PluginInfo {
  name: string;
  version: string;
  description?: string;
  author?: string;
  enabled: boolean;
  options?: PluginOptions;
  defaultConfig?: PluginDefaultConfig;
  toolsCount: number;
}

export interface PluginManagerOptions {
  getConfig: () => Config;
  workspace: string;
  tempDir: string;
  toolRegistry: ToolRegistry;
  publishOutbound(message: OutboundMessage): Promise<void>;
  logger?: Logger;
}
