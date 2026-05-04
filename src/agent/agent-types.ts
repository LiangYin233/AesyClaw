import type {
  Agent as PiAgent,
  AgentMessage as PiAgentMessage,
  StreamFn,
} from '@mariozechner/pi-agent-core';
import type { Api, Model, TextContent, ToolCall, Usage } from '@mariozechner/pi-ai';
import type { SessionKey } from '@aesyclaw/core/types';
import type { ToolExecutionResult } from '@aesyclaw/tool/tool-registry';

export type Agent = PiAgent;
export type AgentMessage = PiAgentMessage;
export type ResolvedModel = Model<Api> & {
  modelId: string;
  apiKey?: string;
  apiType: Api;
  extraBody?: Record<string, unknown>;
};
export type { StreamFn };

export type AgentTool = {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  execute: (toolCallId: string, params: unknown, signal?: AbortSignal) => Promise<AgentToolResult>;
};

export type AgentToolResult = {
  content: TextContent[];
  details: unknown;
  isError?: boolean;
  terminate?: boolean;
};

export type BeforeToolCallHookContext = {
  toolName: string;
  params: unknown;
  sessionKey: SessionKey;
};

export type AfterToolCallHookContext = {
  toolName: string;
  params: unknown;
  result: ToolExecutionResult;
  sessionKey: SessionKey;
};

export type BeforeToolCallHookResult = {
  block?: boolean;
  reason?: string;
  shortCircuit?: ToolExecutionResult;
};

export type AfterToolCallHookResult = {
  override?: Partial<ToolExecutionResult>;
};

export type MemoryConfig = {
  maxContextTokens: number;
  compressionThreshold: number;
};

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

/**
 * 创建一个用户消息。
 *
 * @param content - 消息文本内容
 * @param timestamp - 可选时间戳，默认为当前时间
 * @returns 用户角色的 AgentMessage
 */
export function createUserMessage(content: string, timestamp: number = Date.now()): AgentMessage {
  return {
    role: 'user',
    content,
    timestamp,
  };
}

/**
 * 创建一个持久化的助手消息。
 *
 * 用于从数据库加载历史记录时，将纯文本恢复为带零用量标记的助手消息。
 *
 * @param content - 助手回复的纯文本内容
 * @param timestamp - 可选时间戳，默认为当前时间
 * @returns 助手角色的 AgentMessage
 */
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

/**
 * 从消息中提取纯文本内容。
 *
 * 支持 user（字符串或 TextContent 数组）和 assistant/toolResult（TextContent 数组）消息。
 *
 * @param message - 要提取文本的 AgentMessage
 * @returns 拼接后的纯文本字符串
 */
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

/**
 * 检查助手消息是否包含工具调用。
 *
 * @param message - 要检查的 AgentMessage
 * @returns 如果消息包含 toolCall 内容则返回 true
 */
export function assistantHasToolCalls(message: AgentMessage): boolean {
  return (
    message.role === 'assistant' &&
    message.content.some((content): content is ToolCall => content.type === 'toolCall')
  );
}
