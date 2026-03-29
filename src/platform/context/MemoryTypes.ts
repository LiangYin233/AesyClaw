// src/platform/context/MemoryTypes.ts
export type MemoryEntryKind = 'profile' | 'preference' | 'project' | 'rule' | 'context' | 'other';
export type MemoryEntryStatus = 'active' | 'archived' | 'deleted';
export type MemoryOperationAction = 'create' | 'update' | 'merge' | 'archive' | 'delete';
export type MemoryOperationActor = 'background' | 'tool' | 'api' | 'migration';

export interface LongTermMemoryEntry {
  id: number;
  channel: string;
  chatId: string;
  kind: MemoryEntryKind;
  content: string;
  status: MemoryEntryStatus;
  confidence: number;
  confirmations: number;
  createdAt?: string;
  updatedAt?: string;
  lastSeenAt?: string;
}

export interface LongTermMemoryOperation {
  id: number;
  channel: string;
  chatId: string;
  entryId?: number;
  action: MemoryOperationAction;
  actor: MemoryOperationActor;
  reason?: string;
  before?: unknown;
  after?: unknown;
  evidence?: string[];
  createdAt?: string;
}

export interface MemoryOperationInput {
  action: MemoryOperationAction;
  entryId?: number;
  sourceIds?: number[];
  kind?: MemoryEntryKind;
  content?: string;
  reason?: string;
  evidence?: string[];
}

export interface MemoryOperationResult {
  action: MemoryOperationAction;
  entry?: LongTermMemoryEntry;
  changed: boolean;
}
