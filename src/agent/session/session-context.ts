import type { AgentEngine } from '../engine.js';
import type { SessionMemoryManager } from '../memory/session-memory-manager.js';

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

export interface SessionContext {
  session: SessionRecord;
  agent: AgentEngine;
  memory: SessionMemoryManager;
}
