import type { ScopedLogger } from '@/platform/observability/logger.js';
import type { ChannelReceiveMessage, ChannelSendMessage } from '@/agent/types.js';
import type { ChannelSendPayload } from '@/channels/channel-plugin.js';
import type { CommandDefinition } from '@/contracts/commands.js';
import type { StandardMessage } from '@/platform/llm/types.js';
import type { ToolExecutionResult } from '@/platform/tools/types.js';
import type { ToolRegistry } from '@/platform/tools/registry.js';

export interface PluginToolExecuteContext {
  chatId: string;
  senderId: string;
  [key: string]: unknown;
}

export interface ParameterDefinition {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  items?: ParameterDefinition;
  properties?: Record<string, ParameterDefinition>;
  required?: string[];
  [key: string]: unknown;
}

export interface PluginToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ParameterDefinition>;
    required?: string[];
    [key: string]: unknown;
  };
  execute: (
    _args: unknown,
    _context: PluginToolExecuteContext
  ) => Promise<{ success: boolean; content: string; error?: string }>;
}

export type PluginLogger = ScopedLogger;

export interface PluginContext<TOptions = Record<string, unknown>> {
  logger: PluginLogger;
  config: TOptions;
  toolRegistry: ToolRegistry;
  send?: (_payload: ChannelSendPayload) => Promise<void>;
  channelId?: string;
}

export interface HookPayloadLLMTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface HookPayloadLLMSkill {
  name: string;
  description: string;
  metadata: Record<string, unknown>;
}

export interface HookPayloadReceive {
  message: ChannelReceiveMessage;
}

export interface HookPayloadBeforeLLMRequest {
  messages: ReadonlyArray<StandardMessage>;
  tools: HookPayloadLLMTool[];
  skills: HookPayloadLLMSkill[];
}

export interface HookPayloadToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface HookPayloadAfterToolCall {
  toolCall: HookPayloadToolCall;
  result: {
    success: boolean;
    content: string;
    error?: string;
  };
}

export interface HookPayloadSend {
  message: ChannelSendMessage & { chatId: string };
}

export interface HookBlockResult {
  action: 'block';
  reason?: string;
}

export interface HookContinueResult<T> {
  action: 'continue';
  value: T;
}

export interface HookShortCircuitResult {
  action: 'shortCircuit';
  result: ToolExecutionResult;
}

export type HookReceiveResult = HookContinueResult<ChannelReceiveMessage> | HookBlockResult;
export type HookSendResult = HookContinueResult<ChannelSendMessage & { chatId: string }> | HookBlockResult;
export type HookBeforeLLMRequestResult = { action: 'continue' } | HookBlockResult;
export type HookBeforeToolCallResult = { action: 'continue' } | HookShortCircuitResult;
export type HookAfterToolCallResult = HookContinueResult<ToolExecutionResult>;

export type ReceiveDispatchResult =
  | { blocked: true; reason?: string }
  | { blocked: false; message: HookPayloadReceive['message'] };

export type SendDispatchResult =
  | { blocked: true; reason?: string }
  | { blocked: false; message: HookPayloadSend['message'] };

export type BeforeLLMRequestDispatchResult =
  | { blocked: true; reason?: string }
  | { blocked: false };

export type BeforeToolCallDispatchResult =
  | { shortCircuited: true; result: ToolExecutionResult }
  | { shortCircuited: false };

export interface PluginHooks {
  onReceive?: (
    _payload: HookPayloadReceive
  ) => Promise<HookReceiveResult>;
  beforeLLMRequest?: (
    _payload: HookPayloadBeforeLLMRequest
  ) => Promise<HookBeforeLLMRequestResult>;
  beforeToolCall?: (
    _toolCall: HookPayloadToolCall
  ) => Promise<HookBeforeToolCallResult>;
  afterToolCall?: (
    _payload: HookPayloadAfterToolCall
  ) => Promise<HookAfterToolCallResult>;
  onSend?: (
    _payload: HookPayloadSend
  ) => Promise<HookSendResult>;
}

export interface Plugin<TOptions = Record<string, unknown>> {
  name: string;
  version: string;
  description?: string;
  defaultOptions?: TOptions;
  init?: (_ctx: PluginContext<TOptions>) => Promise<void>;
  hooks?: PluginHooks;
  commands?: CommandDefinition[];
  destroy?: () => Promise<void>;
}

export interface PluginInfo {
  name: string;
  description?: string;
  version: string;
  loaded: boolean;
  hooks: string[];
  commands?: number;
}
