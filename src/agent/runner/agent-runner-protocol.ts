import type { AgentRegistry } from '../agent-registry';
import {
  extractMessageText,
  type AgentMessage,
  type AgentTool,
  type AgentToolResult,
  type ResolvedModel,
} from '../agent-types';
import { serializeSessionKey, type SessionKey } from '@aesyclaw/core/types';

export type AgentRunParams = {
  /** 当前执行的角色标识，用于日志和运行隔离。 */
  roleId: string;
  /** 已解析的模型配置，包含 API 类型、密钥和上下文窗口。 */
  model: ResolvedModel;
  /** 注入 Agent 的系统提示。 */
  prompt: string;
  /** 当前角色可用的工具代理定义。 */
  tools: AgentTool[];
  /** 当前会话历史消息。 */
  history: AgentMessage[];
  /** 本轮用户输入文本。 */
  content: string;
  /** 当前会话标识，用于取消和日志关联。 */
  sessionKey: SessionKey;
  /** 触发上下文压缩前可使用的上下文窗口比例。 */
  compressionThreshold: number;
  /** Agent 与运行生命周期注册中心。 */
  registry: AgentRegistry;
};

export type AgentRunResult = {
  /** 本轮执行新增的 Agent 消息。 */
  newMessages: AgentMessage[];
  /** 最终助手文本；无可用文本时为 null。 */
  lastAssistant: string | null;
};

export function createProviderCacheKey(sessionKey: SessionKey): string {
  return `session:${serializeSessionKey(sessionKey)}`;
}

/**
 * 根据当前上下文占用估算单次工具结果回传预算。
 */
export function calculateToolResultBudget(
  model: ResolvedModel,
  compressionThreshold: number,
  history: readonly AgentMessage[],
  content: string,
): { maxToolResultTokens: number; maxToolResultChars: number } {
  const compressionLimitTokens = Math.floor(model.contextWindow * compressionThreshold);
  const historyTextLength = history.reduce(
    (total, message) => total + extractMessageText(message).length,
    0,
  );
  const usedTokens = Math.ceil(historyTextLength / 4) + Math.ceil(content.length / 4);
  const remainingTokens = Math.max(0, compressionLimitTokens - usedTokens);
  const maxToolResultTokens = Math.floor(remainingTokens * 0.5);

  return {
    maxToolResultTokens,
    maxToolResultChars: maxToolResultTokens * 4,
  };
}

export function createAgentRunResult(
  newMessages: readonly AgentMessage[],
  lastAssistant: string | null,
): AgentRunResult {
  return {
    newMessages: [...newMessages],
    lastAssistant: resolveLastAssistant(newMessages, lastAssistant),
  };
}

export function createCancelledRunResult(): AgentRunResult {
  return { newMessages: [], lastAssistant: null };
}

/**
 * 生成最终 assistant 消息的日志元信息。
 */
export function getFinalAssistantMeta(messages: readonly AgentMessage[]): Record<string, unknown> {
  const finalAssistant = findFinalAssistant(messages);
  if (!finalAssistant) return { lastAssistantRole: null };

  const record = finalAssistant as unknown as Record<string, unknown>;
  return {
    lastAssistantRole: finalAssistant.role,
    lastAssistantStopReason: record['stopReason'],
    lastAssistantErrorMessage: record['errorMessage'],
    lastAssistantTextLength: extractAssistantText(finalAssistant).length,
  };
}

/**
 * 按预算限制工具执行结果的内容长度。超出部分截断并在 details 中标记。
 */
export function limitToolResultContent<T extends AgentToolResult>(
  result: T,
  budget: { maxToolResultTokens: number; maxToolResultChars: number },
): T {
  const originalContentLength = result.content.reduce((total, block) => total + block.text.length, 0);
  if (originalContentLength <= budget.maxToolResultChars) return result;

  let remainingChars = budget.maxToolResultChars;
  const content = result.content.map((block) => {
    const text = block.text.slice(0, Math.max(0, remainingChars));
    remainingChars -= text.length;
    return { ...block, text };
  });
  const truncatedContentLength = content.reduce((total, block) => total + block.text.length, 0);

  return {
    ...result,
    content,
    details: {
      ...(typeof result.details === 'object' && result.details !== null && !Array.isArray(result.details)
        ? result.details
        : {}),
      truncated: true,
      originalContentLength,
      truncatedContentLength,
      maxToolResultTokens: budget.maxToolResultTokens,
    },
  };
}

function resolveLastAssistant(
  newMessages: readonly AgentMessage[],
  reportedLastAssistant: string | null,
): string | null {
  const finalAssistant = findFinalAssistant(newMessages);
  if (!finalAssistant) return reportedLastAssistant;

  const errorMessage = getAssistantErrorMessage(finalAssistant);
  if (errorMessage) return `[模型错误: ${errorMessage}]`;

  const text = extractAssistantText(finalAssistant).trim();
  return text.length > 0 ? text : null;
}

function findFinalAssistant(messages: readonly AgentMessage[]): AgentMessage | null {
  for (const message of [...messages].reverse()) {
    if (message.role === 'assistant') return message;
  }
  return null;
}

function getAssistantErrorMessage(message: AgentMessage): string | null {
  if (message.role !== 'assistant') return null;
  const record = message as unknown as Record<string, unknown>;
  if (record['stopReason'] !== 'error') return null;
  return typeof record['errorMessage'] === 'string' && record['errorMessage'].trim().length > 0
    ? record['errorMessage'].trim()
    : '模型调用失败但未返回错误详情';
}

function extractAssistantText(message: AgentMessage): string {
  if (message.role !== 'assistant') return '';
  return message.content
    .filter((content): content is { type: 'text'; text: string } => content.type === 'text')
    .map((content) => content.text)
    .join('\n');
}
