import type {
  AgentMessage as PiAgentMessage,
  StreamFn,
} from '@mariozechner/pi-agent-core';
import type { Api, Model, TextContent, ToolCall, Usage } from '@mariozechner/pi-ai';
import type { SessionKey } from '@aesyclaw/core/types';
import type { ToolExecutionResult } from '@aesyclaw/tool/tool-registry';

/**
 * PiAgent 的消息类型别名。
 */
export type AgentMessage = PiAgentMessage;

/**
 * 解析后的模型配置，包含 modelId、API 密钥、API 类型和额外请求体。
 */
export type ResolvedModel = Model<Api> & {
  modelId: string;
  apiKey?: string;
  apiType: Api;
  extraBody?: Record<string, unknown>;
};

export type { StreamFn };

/**
 * Agent 可用的工具定义。
 * execute 函数在工具被调用时执行，返回 AgentToolResult。
 */
export type AgentTool = {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  execute: (toolCallId: string, params: unknown, signal?: AbortSignal) => Promise<AgentToolResult>;
};

/**
 * 工具执行结果，包含文本内容块和元信息。
 */
export type AgentToolResult = {
  content: TextContent[];
  details: unknown;
  isError?: boolean;
  terminate?: boolean;
};

/**
 * 工具调用前钩子的上下文信息。
 */
export type BeforeToolCallHookContext = {
  toolName: string;
  params: unknown;
  sessionKey: SessionKey;
};

/**
 * 工具调用后钩子的上下文信息。
 */
export type AfterToolCallHookContext = {
  toolName: string;
  params: unknown;
  result: ToolExecutionResult;
  sessionKey: SessionKey;
};

/**
 * 工具调用前钩子的返回结果，可阻止或短路工具调用。
 */
export type BeforeToolCallHookResult = {
  block?: boolean;
  reason?: string;
  shortCircuit?: ToolExecutionResult;
};

/**
 * 工具调用后钩子的返回结果，可覆盖执行结果。
 */
export type AfterToolCallHookResult = {
  override?: Partial<ToolExecutionResult>;
};


/**
 * 支持的 LLM API 类型常量映射。
 */
export const ApiType = {
  OPENAI_RESPONSES: 'openai-responses',
  OPENAI_COMPLETIONS: 'openai-completions',
  ANTHROPIC_MESSAGES: 'anthropic-messages',
} as const satisfies Record<string, Api>;

/**
 * 根据 ResolvedModel 的 extraBody 构造 onPayload 回调。
 *
 * 如果 extraBody 为空或未定义，返回 undefined（不修改 payload）。
 * 否则返回一个浅合并函数：{ ...payload, ...extraBody }。
 *
 * @param model - 已解析的模型配置
 * @returns onPayload 回调或 undefined
 */
export function makeExtraBodyOnPayload(
  model: ResolvedModel,
): ((payload: unknown) => unknown) | undefined {
  const extraBody = model.extraBody;
  if (!extraBody || Object.keys(extraBody).length === 0) {
    return undefined;
  }
  return (payload: unknown) => {
    if (typeof payload === 'object' && payload !== null) {
      return { ...(payload as Record<string, unknown>), ...extraBody };
    }
    return payload;
  };
}

const ZERO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
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
    api: ApiType.OPENAI_RESPONSES,
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
