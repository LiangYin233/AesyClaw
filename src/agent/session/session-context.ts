import type { AgentEngine } from '../engine.js';
import type { SessionMemoryManager } from '../memory/session-memory-manager.js';
import type { MessageRole, StandardMessage } from '@/platform/llm/types.js';

export interface SessionRecord {
  id: string;
  channel: string;
  type: string;
  chatId: string;
  roleId: string;
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
}

export interface SessionMessageRecord {
  id: string;
  sessionId: string;
  sequence: number;
  role: MessageRole;
  content: string;
  toolCalls?: StandardMessage['toolCalls'];
  toolCallId?: string;
  name?: string;
  createdAt: Date;
}

export interface SessionContext {
  session: SessionRecord;
  agent: AgentEngine;
  memory: SessionMemoryManager;
}
