import type {
  MessageUsage,
  PersistableMessage,
  PersistableToolCall,
  PersistableToolResult,
} from '@aesyclaw/core/types';
import { completeMessageUsage } from '@aesyclaw/core/types';
import { createScopedLogger } from '@aesyclaw/core/logger';
import { createUserMessage, type AgentMessage } from '@aesyclaw/contracts/llm';
import { createPersistedAssistantMessage, ApiType } from '@aesyclaw/agent/types';
import type { SessionFileStore } from './file-store';

const logger = createScopedLogger('session:rehydrate');

export async function loadAndRehydrateMessages(
  store: Pick<SessionFileStore, 'load'>,
  sessionId: string,
): Promise<AgentMessage[]> {
  const records = await store.load(sessionId);
  return rehydrateMessages(records);
}

export function rehydrateMessages(records: readonly PersistableMessage[]): AgentMessage[] {
  return records.map((record) => rehydrateMessage(record));
}

function rehydrateMessage(record: PersistableMessage): AgentMessage {
  if (record.role === 'user') {
    return createUserMessage(record.content, parseTimestamp(record.timestamp));
  }

  if (record.role === 'toolResult') {
    return reconstructToolResultMessage(record.content, record.toolData, record.timestamp);
  }

  if (record.toolData) {
    return reconstructAssistantWithToolCalls(
      record.content,
      record.toolData,
      record.usage,
      record.timestamp,
    );
  }

  return createPersistedAssistantMessage(
    record.content,
    parseTimestamp(record.timestamp),
    completeMessageUsage(record.usage),
  );
}

function parseTimestamp(timestamp?: string): number {
  if (!timestamp) return Date.now();
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

function reconstructAssistantWithToolCalls(
  content: string,
  toolData: string | undefined,
  usage: MessageUsage | undefined,
  timestamp: string | undefined,
): AgentMessage {
  let tcs: PersistableToolCall[] = [];
  let stopReason: string = 'stop';
  if (toolData) {
    try {
      const parsed = JSON.parse(toolData);
      if (Array.isArray(parsed)) {
        tcs = parsed as PersistableToolCall[];
      } else {
        tcs = (parsed as { toolCalls: PersistableToolCall[] }).toolCalls ?? [];
        stopReason = (parsed as { stopReason?: string }).stopReason ?? 'stop';
      }
    } catch {
      logger.warn('解析助理消息 toolData 失败，将使用空工具调用', { toolData });
    }
  }
  const textContent: { type: 'text'; text: string } = { type: 'text', text: content };
  const toolCallContents = tcs.map((tc) => ({
    type: 'toolCall' as const,
    id: tc.id,
    name: tc.name,
    arguments: tc.arguments,
  }));
  return {
    role: 'assistant',
    content: [textContent, ...toolCallContents],
    api: ApiType.OPENAI_RESPONSES,
    provider: 'persisted-history',
    model: 'persisted-history',
    usage: completeMessageUsage(usage),
    stopReason: stopReason as 'stop' | 'toolUse' | 'length' | 'error' | 'aborted',
    timestamp: parseTimestamp(timestamp),
  } as AgentMessage;
}

function reconstructToolResultMessage(
  content: string,
  toolData: string | undefined,
  timestamp: string | undefined,
): AgentMessage {
  let meta: PersistableToolResult;
  if (toolData) {
    try {
      meta = JSON.parse(toolData) as PersistableToolResult;
    } catch {
      logger.warn('解析 toolResult 消息 toolData 失败，将使用默认值', { toolData });
      meta = { toolCallId: '', toolName: '', isError: false };
    }
  } else {
    meta = { toolCallId: '', toolName: '', isError: false };
  }
  return {
    role: 'toolResult',
    toolCallId: meta.toolCallId,
    toolName: meta.toolName,
    isError: meta.isError,
    content: [{ type: 'text', text: content }],
    ...(meta.details !== undefined ? { details: meta.details } : {}),
    timestamp: parseTimestamp(timestamp),
  } as AgentMessage;
}
