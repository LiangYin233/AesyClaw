/**
 * contracts/llm — LLM 相关公共类型和常量。
 *
 * 此模块应保持轻量，只依赖外部 pi 包。不依赖任何内部模块。
 */

import type { AgentMessage as PiAgentMessage, StreamFn } from '@mariozechner/pi-agent-core';
import type { Api, Model, TextContent, ToolCall } from '@mariozechner/pi-ai';

// ─── 消息类型 ─────────────────────────────────────────────────────

/** Agent 消息类型（PiAgent 消息别名） */
export type AgentMessage = PiAgentMessage;

export type { StreamFn };

// ─── 模型类型 ─────────────────────────────────────────────────────

/** 解析后的模型配置，包含 modelId、API 密钥、API 类型和额外请求体 */
export type ResolvedModel = Model<Api> & {
  modelId: string;
  apiKey?: string;
  apiType: Api;
  extraBody?: Record<string, unknown>;
};

// ─── 工具类型 ─────────────────────────────────────────────────────

/** Agent 可用的工具定义 */
export type AgentTool = {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  execute: (toolCallId: string, params: unknown, signal?: AbortSignal) => Promise<AgentToolResult>;
};

/** 工具执行结果 */
export type AgentToolResult = {
  content: TextContent[];
  details: unknown;
  isError?: boolean;
  terminate?: boolean;
};

// ─── API 类型常量 ────────────────────────────────────────────────

/** 支持的 LLM API 类型常量映射 */
export const ApiType = {
  OPENAI_RESPONSES: 'openai-responses',
  OPENAI_COMPLETIONS: 'openai-completions',
  ANTHROPIC_MESSAGES: 'anthropic-messages',
} as const satisfies Record<string, Api>;

// ─── 工具函数 ──────────────────────────────────────────────────────

/**
 * 根据 ResolvedModel 的 extraBody 构造 onPayload 回调。
 *
 * 如果 extraBody 为空或未定义，返回 undefined（不修改 payload）。
 * 否则返回一个浅合并函数：{ ...payload, ...extraBody }。
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

// ─── 类型守卫 ──────────────────────────────────────────────────────

/** 检查助手消息是否包含工具调用 */
export function assistantHasToolCalls(message: AgentMessage): boolean {
  return (
    message.role === 'assistant' &&
    message.content.some((content): content is ToolCall => content.type === 'toolCall')
  );
}

// ─── 消息构造 ────────────────────────────────────────────────────

/** 创建一个用户消息 */
export function createUserMessage(content: string, timestamp: number = Date.now()): AgentMessage {
  return {
    role: 'user',
    content,
    timestamp,
  };
}

/** 从消息中提取纯文本内容 */
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
