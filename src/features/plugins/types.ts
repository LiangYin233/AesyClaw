import type { Logger } from '../../platform/observability/logger.js';
import type { ToolRegistry } from '../../platform/tools/registry.js';
import type { SkillManager } from '../skills/skill-manager.js';
import type { StandardMessage } from '../../agent/llm/types.js';
import type { CommandDefinition } from '../commands/types.js';

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

export interface PluginContext {
  logger: Logger;
  config: Record<string, unknown>;
  toolRegistry: ToolRegistry;
  skillManager?: SkillManager;
}

export interface HookPayloadMessageReceive {
  message: {
    channelId: string;
    chatId: string;
    senderId: string;
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
