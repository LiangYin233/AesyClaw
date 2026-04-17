import type { ScopedLogger } from '@/platform/observability/logger.js';
import type { IOutboundMessage, IUnifiedMessage } from '@/agent/types.js';
import type { IOutboundPayload } from '@/channels/channel-plugin.js';
import type { CommandDefinition } from '@/contracts/commands.js';
import type { StandardMessage } from '@/platform/llm/types.js';
import type { ToolExecutionResult } from '@/platform/tools/types.js';
import type { ToolRegistry } from '@/platform/tools/registry.js';

export interface PluginToolExecuteContext {
  chatId: string;
  senderId: string;
  traceId: string;
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
  sendFn?: (_payload: IOutboundPayload) => Promise<void>;
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

export interface HookPayloadMessageReceive {
  message: IUnifiedMessage;
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

export interface HookPayloadMessageSend {
  message: IOutboundMessage & { chatId: string };
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

export type HookMessageReceiveResult = HookContinueResult<IUnifiedMessage> | HookBlockResult;
export type HookMessageSendResult = HookContinueResult<IOutboundMessage & { chatId: string }> | HookBlockResult;
export type HookBeforeLLMRequestResult = { action: 'continue' } | HookBlockResult;
export type HookBeforeToolCallResult = { action: 'continue' } | HookShortCircuitResult;
export type HookAfterToolCallResult = HookContinueResult<ToolExecutionResult>;

export type MessageReceiveDispatchResult =
  | { blocked: true; reason?: string }
  | { blocked: false; message: HookPayloadMessageReceive['message'] };

export type MessageSendDispatchResult =
  | { blocked: true; reason?: string }
  | { blocked: false; message: HookPayloadMessageSend['message'] };

export type BeforeLLMRequestDispatchResult =
  | { blocked: true; reason?: string }
  | { blocked: false };

export type BeforeToolCallDispatchResult =
  | { shortCircuited: true; result: ToolExecutionResult }
  | { shortCircuited: false };

export interface PluginHooks {
  onMessageReceive?: (
    _payload: HookPayloadMessageReceive
  ) => Promise<HookMessageReceiveResult>;
  beforeLLMRequest?: (
    _payload: HookPayloadBeforeLLMRequest
  ) => Promise<HookBeforeLLMRequestResult>;
  beforeToolCall?: (
    _toolCall: HookPayloadToolCall
  ) => Promise<HookBeforeToolCallResult>;
  afterToolCall?: (
    _payload: HookPayloadAfterToolCall
  ) => Promise<HookAfterToolCallResult>;
  onMessageSend?: (
    _payload: HookPayloadMessageSend
  ) => Promise<HookMessageSendResult>;
}

export interface IPlugin<TOptions = Record<string, unknown>> {
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
