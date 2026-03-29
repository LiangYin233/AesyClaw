// src/platform/context/SessionContext.ts
import type { Database } from '../../platform/db/index.js';

export interface Session {
  key: string;
  id?: number;
  channel: string;
  chatId: string;
  uuid?: string;
  summary: string;
  summarizedMessageCount: number;
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp?: string;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
}

export interface SessionRoute {
  sessionKey: string;
  channelChatKey: string;
}

export function parseSessionKey(key: string): { channel: string; chatId: string; uuid?: string } {
  const parts = key.split(':');
  const channel = parts[0]?.trim();
  const chatId = parts[1]?.trim();

  if (!channel || !chatId) {
    throw new SessionValidationError('session key must use format "channel:chatId[:uuid]"', {
      field: 'key',
      key
    });
  }

  if (parts.length >= 3) {
    const uuid = parts.slice(2).join(':').trim();
    return { channel, chatId, ...(uuid ? { uuid } : {}) };
  }

  return { channel, chatId };
}

export interface ISessionRouting {
  resolve(msg: { channel: string; chatId: string; sessionKey?: string }): Promise<SessionRoute>;
  createNewSession(channel: string, chatId: string): string;
  switchSession(channel: string, chatId: string, sessionKey: string): void;
  getActiveSession(channel: string, chatId: string): string | undefined;
  resolveByChannel(channel: string, chatId: string): string | undefined;
  getContextMode(): string;
  setContextMode(contextMode: string): void;
  getConversationAgent(channel: string, chatId: string): string | undefined;
  setConversationAgent(channel: string, chatId: string, agentName: string): void;
  clearConversationAgent(channel: string, chatId: string): void;
  deleteAgentBindings(agentName: string): number;
  deleteSessionBinding(sessionKey: string, channel: string, chatId: string): void;
}

export interface SessionManager {
  ready(): Promise<void>;
  createSessionKey(channel: string, chatId: string, uuid?: string): string;
  createNewSession(channel: string, chatId: string): string;
  getOrCreate(key: string): Promise<Session>;
  get(key: string): Promise<Session | null>;
  getExistingOrThrow(key: string): Promise<Session>;
  addMessage(key: string, role: 'user' | 'assistant' | 'system', content: string): Promise<void>;
  updateSummary(key: string, summary: string, summarizedMessageCount: number): Promise<void>;
  getConversationMessages(channel: string, chatId: string): Promise<Array<{
    id: number; sessionId: number; sessionKey: string;
    role: 'user' | 'assistant' | 'system'; content: string; timestamp?: string;
  }>>;
  getConversationMemory(channel: string, chatId: string): Promise<{
    channel: string; chatId: string; summary: string;
    summarizedUntilMessageId: number; updatedAt?: string;
  }>;
  updateConversationSummary(channel: string, chatId: string, summary: string, summarizedUntilMessageId: number): Promise<void>;
  clearSummary(key: string): Promise<void>;
  clearAllSummaries(): Promise<void>;
  clearConversationSummaries(channel: string, chatId: string): Promise<void>;
  list(): Session[];
  delete(key: string): Promise<void>;
  count(): number;
  loadAll(): Promise<void>;
  close(): Promise<void>;
}

export class SessionValidationError extends Error {
  constructor(
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'SessionValidationError';
  }
}

export class SessionNotFoundError extends Error {
  constructor(sessionKey: string) {
    super(`Session with id "${sessionKey}" not found`);
    this.name = 'SessionNotFoundError';
  }
}

export interface LongTermMemoryStore {
  listEntries(channel: string, chatId: string, options?: {
    statuses?: Array<'active' | 'archived' | 'deleted'>;
    limit?: number;
  }): Promise<Array<{
    id: number; channel: string; chatId: string; kind: string;
    content: string; status: string; confidence: number; confirmations: number;
    createdAt?: string; updatedAt?: string; lastSeenAt?: string;
  }>>;
  listOperations(channel: string, chatId: string, limit?: number): Promise<Array<{
    id: number; channel: string; chatId: string; entryId?: number;
    action: string; actor: string; reason?: string; createdAt?: string;
  }>>;
  applyOperation(
    channel: string, chatId: string,
    operation: { action: string; entryId?: number; sourceIds?: number[]; kind?: string; content?: string; reason?: string; evidence?: string[] },
    actor: string
  ): Promise<{ action: string; entry?: any; changed: boolean }>;
  deleteConversationEntries(channel: string, chatId: string, actor: string, reason: string): Promise<number>;
  deleteAllEntries(actor: string, reason: string): Promise<number>;
}

export interface SessionContext {
  db: Database;
  sessionManager: SessionManager;
  longTermMemoryStore: LongTermMemoryStore;
  sessionRouting: ISessionRouting;
}
