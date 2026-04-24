import type {
  Agent as PiAgent,
  AgentMessage as PiAgentMessage,
  StreamFn,
} from '@mariozechner/pi-agent-core';
import type { Api, Model, TextContent, ImageContent, ToolCall, Usage } from '@mariozechner/pi-ai';
import type { SessionKey } from '../core/types';
import type { ToolExecutionResult } from '../tool/tool-registry';

export type Agent = PiAgent;
export type AgentMessage = PiAgentMessage;
export type RuntimeTextContent = TextContent;
export type RuntimeImageContent = ImageContent;
export type RuntimeToolCall = ToolCall;
export type RuntimeModel = Model<Api> & {
  modelId: string;
  realModelName?: string;
  apiKey?: string;
  apiType: Api;
};
export type ResolvedModel = RuntimeModel;
export type { StreamFn };

export interface AgentTool {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  execute: (toolCallId: string, params: unknown, signal?: AbortSignal) => Promise<AgentToolResult>;
  executionMode?: 'sequential' | 'parallel';
}

export interface AgentToolResult {
  content: TextContent[];
  details?: unknown;
  terminate?: boolean;
}

export interface AgentContext {
  sessionKey: SessionKey;
}

export interface BeforeToolCallHookContext {
  toolName: string;
  params: unknown;
  sessionKey: SessionKey;
}

export interface AfterToolCallHookContext {
  toolName: string;
  params: unknown;
  result: ToolExecutionResult;
  sessionKey: SessionKey;
}

export interface BeforeToolCallHookResult {
  block?: boolean;
  reason?: string;
  shortCircuit?: ToolExecutionResult;
}

export interface AfterToolCallHookResult {
  override?: Partial<ToolExecutionResult>;
}

export interface SubAgentRoleParams {
  roleId: string;
  prompt: string;
  maxSteps?: number;
  enableTools?: boolean;
}

export interface SubAgentTempParams {
  systemPrompt: string;
  model?: string;
  prompt: string;
  maxSteps?: number;
  enableTools?: boolean;
}

export interface MemoryConfig {
  maxContextTokens: number;
  compressionThreshold: number;
}

const ZERO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
};

export function createUserMessage(content: string, timestamp: number = Date.now()): AgentMessage {
  return {
    role: 'user',
    content,
    timestamp,
  };
}

export function createPersistedAssistantMessage(
  content: string,
  timestamp: number = Date.now(),
): AgentMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: content }],
    api: 'openai-responses',
    provider: 'persisted-history',
    model: 'persisted-history',
    usage: ZERO_USAGE,
    stopReason: 'stop',
    timestamp,
  };
}

export function extractMessageText(message: AgentMessage): string {
  if (message.role === 'user') {
    return typeof message.content === 'string'
      ? message.content
      : message.content
          .filter((content): content is TextContent => content.type === 'text')
          .map((content) => content.text)
          .join('');
  }

  if (message.role === 'assistant' || message.role === 'toolResult') {
    return message.content
      .filter((content): content is TextContent => content.type === 'text')
      .map((content) => content.text)
      .join('');
  }

  return '';
}

export function assistantHasToolCalls(message: AgentMessage): boolean {
  return (
    message.role === 'assistant' &&
    message.content.some((content): content is ToolCall => content.type === 'toolCall')
  );
}
