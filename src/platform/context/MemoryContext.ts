// src/platform/context/MemoryContext.ts
import type { Session, SessionMessage } from '../../agent/infrastructure/session/SessionManager.js';
import type { InboundMessage } from '../../types.js';
import type { LongTermMemoryEntry, LongTermMemoryOperation, MemoryOperationInput, MemoryOperationActor, MemoryOperationResult } from './MemoryTypes.js';

export interface MemoryService {
  buildHistory(session: Session, request?: Pick<InboundMessage, 'content'> & Partial<Pick<InboundMessage, 'media' | 'files'>>): Promise<SessionMessage[]>;
  hasLongTermMemory(): boolean;
  listLongTermMemory(channel: string, chatId: string): Promise<LongTermMemoryEntry[]>;
  listLongTermMemoryOperations(channel: string, chatId: string, limit?: number): Promise<LongTermMemoryOperation[]>;
  applyLongTermMemoryOperations(
    channel: string,
    chatId: string,
    operations: MemoryOperationInput[],
    actor: MemoryOperationActor
  ): Promise<MemoryOperationResult[]>;
  maybeSummarizeSession(sessionKey: string): Promise<boolean>;
  enqueueLongTermMemoryMaintenance(
    sessionKey: string,
    request: Pick<InboundMessage, 'content'> & Partial<Pick<InboundMessage, 'media' | 'files'>>,
    assistantContent: string
  ): void;
}

export interface MemoryContext {
  memoryService: MemoryService;
}
