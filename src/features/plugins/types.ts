import type { ToolRegistry } from '../../platform/tools/registry.js';
import type { SkillManager } from '../skills/skill-manager.js';
import type { StandardMessage } from '../../agent/llm/types.js';
import type { CommandDefinition } from '../commands/types.js';
import type { ChannelPipeline } from '../../agent/core/pipeline.js';
import type { IOutboundPayload } from '../../channels/channel-plugin.js';

export interface ToolExecuteContext {
  chatId: string;
  senderId: string;
  traceId: string;
  [key: string]: unknown;
}

export interface PluginToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
    [key: string]: unknown;
  };
  execute: (
    args: unknown,
    context: ToolExecuteContext
  ) => Promise<{ success: boolean; content: string; error?: string }>;
}

export interface PluginLogger {
  info: (msg: string, data?: Record<string, unknown>) => void;
  warn: (msg: string, data?: Record<string, unknown>) => void;
  error: (msg: string, data?: Record<string, unknown>) => void;
  debug: (msg: string, data?: Record<string, unknown>) => void;
}

export interface PluginContext {
  logger: PluginLogger;
  config: Record<string, unknown>;
  toolRegistry: ToolRegistry;
  skillManager?: SkillManager;
  pipeline?: ChannelPipeline;
  sendFn?: (payload: IOutboundPayload) => Promise<void>;
  channelId?: string;
}

export interface HookPayloadMessageReceive {
  message: {
    channelId: string;
    chatId: string;
    text: string;
    timestamp?: number;
    metadata?: Record<string, unknown>;
  };
}

export interface HookPayloadBeforeLLMRequest {
  messages: StandardMessage[];
  tools: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
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
  message: {
    chatId: string;
    text: string;
    mediaFiles?: Array<{
      type: string;
      url: string;
    }>;
    error?: string;
  };
}

export interface PluginHooks {
  onMessageReceive?: (
    payload: HookPayloadMessageReceive
  ) => Promise<HookPayloadMessageReceive['message'] | null>;
  beforeLLMRequest?: (
    payload: HookPayloadBeforeLLMRequest
  ) => Promise<void>;
  beforeToolCall?: (
    toolCall: HookPayloadToolCall
  ) => Promise<{ success: boolean; content: string; error?: string } | null>;
  afterToolCall?: (
    payload: HookPayloadAfterToolCall
  ) => Promise<HookPayloadAfterToolCall['result']>;
  onMessageSend?: (
    payload: HookPayloadMessageSend
  ) => Promise<HookPayloadMessageSend['message'] | null>;
}

export interface IPlugin {
  name: string;
  version: string;
  description?: string;
  init?: (ctx: PluginContext) => Promise<void>;
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

export type HookName = keyof PluginHooks;

export type HookPayloadMap = {
  onMessageReceive: HookPayloadMessageReceive;
  beforeLLMRequest: HookPayloadBeforeLLMRequest;
  beforeToolCall: HookPayloadToolCall;
  afterToolCall: HookPayloadAfterToolCall;
  onMessageSend: HookPayloadMessageSend;
};

export type HookResultMap = {
  onMessageReceive: HookPayloadMessageReceive['message'] | null;
  beforeLLMRequest: void;
  beforeToolCall: { success: boolean; content: string; error?: string } | null;
  afterToolCall: HookPayloadAfterToolCall['result'];
  onMessageSend: HookPayloadMessageSend['message'] | null;
};
