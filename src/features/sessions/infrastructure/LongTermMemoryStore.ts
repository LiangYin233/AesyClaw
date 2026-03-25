import { type Database, type DBMemoryEmbedding, type DBMemoryEntry, type DBMemoryOperation } from '../../../platform/db/index.js';
import { formatLocalTimestamp } from '../../../platform/observability/logging.js';

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

export interface LongTermMemoryEmbedding {
  entryId: number;
  providerName: string;
  model: string;
  contentHash: string;
  dimensions: number;
  embedding: number[];
  updatedAt?: string;
}

export interface LongTermMemoryEntryWithEmbedding {
  entry: LongTermMemoryEntry;
  embedding?: LongTermMemoryEmbedding;
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

const DEFAULT_KINDS: MemoryEntryKind[] = ['profile', 'preference', 'project', 'rule', 'context', 'other'];

export class LongTermMemoryStore {
  private static readonly MAX_CONFIDENCE = 10;

  constructor(private db: Database) {}

  private normalizeContent(content?: string): string {
    return typeof content === 'string' ? content.trim() : '';
  }

  private normalizeKind(kind?: string): MemoryEntryKind {
    return DEFAULT_KINDS.includes(kind as MemoryEntryKind) ? (kind as MemoryEntryKind) : 'other';
  }

  private parseJson<T>(value?: string | null): T | undefined {
    if (!value) {
      return undefined;
    }

    try {
      return JSON.parse(value) as T;
    } catch {
      return undefined;
    }
  }

  private mapEntry(row: DBMemoryEntry): LongTermMemoryEntry {
    return {
      id: row.id,
      channel: row.channel,
      chatId: row.chat_id,
      kind: row.kind as MemoryEntryKind,
      content: row.content,
      status: row.status as MemoryEntryStatus,
      confidence: row.confidence,
      confirmations: row.confirmations,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastSeenAt: row.last_seen_at
    };
  }

  private mapOperation(row: DBMemoryOperation): LongTermMemoryOperation {
    return {
      id: row.id,
      channel: row.channel,
      chatId: row.chat_id,
      entryId: row.entry_id ?? undefined,
      action: row.action as MemoryOperationAction,
      actor: row.actor as MemoryOperationActor,
      reason: row.reason || undefined,
      before: this.parseJson(row.before_json),
      after: this.parseJson(row.after_json),
      evidence: this.parseJson<string[]>(row.evidence_json) || [],
      createdAt: row.created_at
    };
  }

  private mapEmbedding(row: DBMemoryEmbedding): LongTermMemoryEmbedding {
    return {
      entryId: row.entry_id,
      providerName: row.provider_name,
      model: row.model,
      contentHash: row.content_hash,
      dimensions: row.dimensions,
      embedding: this.parseJson<number[]>(row.embedding_json) || [],
      updatedAt: row.updated_at
    };
  }

  async listEntries(
    channel: string,
    chatId: string,
    options?: {
      statuses?: MemoryEntryStatus[];
      limit?: number;
    }
  ): Promise<LongTermMemoryEntry[]> {
    const statuses = options?.statuses && options.statuses.length > 0
      ? options.statuses
      : ['active', 'archived'];
    const placeholders = statuses.map(() => '?').join(', ');
    const params: Array<string | number> = [channel, chatId, ...statuses];
    let sql = `
      SELECT *
      FROM memory_entries
      WHERE channel = ?
        AND chat_id = ?
        AND status IN (${placeholders})
      ORDER BY
        CASE status
          WHEN 'active' THEN 0
          WHEN 'archived' THEN 1
          ELSE 2
        END ASC,
        confidence DESC,
        datetime(last_seen_at) DESC,
        datetime(updated_at) DESC,
        id DESC
    `;

    if (typeof options?.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0) {
      sql += ' LIMIT ?';
      params.push(Math.floor(options.limit));
    }

    const rows = await this.db.all<DBMemoryEntry>(sql, params);
    return rows.map((row) => this.mapEntry(row));
  }

  async listOperations(channel: string, chatId: string, limit = 50): Promise<LongTermMemoryOperation[]> {
    const rows = await this.db.all<DBMemoryOperation>(
      `SELECT *
       FROM memory_operations
       WHERE channel = ? AND chat_id = ?
       ORDER BY datetime(created_at) DESC, id DESC
       LIMIT ?`,
      [channel, chatId, limit]
    );

    return rows.map((row) => this.mapOperation(row));
  }

  async getEmbedding(
    entryId: number,
    providerName: string,
    model: string
  ): Promise<LongTermMemoryEmbedding | undefined> {
    const row = await this.db.get<DBMemoryEmbedding>(
      `SELECT *
       FROM memory_embeddings
       WHERE entry_id = ? AND provider_name = ? AND model = ?`,
      [entryId, providerName, model]
    );

    return row ? this.mapEmbedding(row) : undefined;
  }

  async upsertEmbedding(args: {
    entryId: number;
    providerName: string;
    model: string;
    contentHash: string;
    embedding: number[];
  }): Promise<void> {
    const now = formatLocalTimestamp(new Date());
    await this.db.run(
      `INSERT INTO memory_embeddings (
        entry_id, provider_name, model, content_hash, dimensions, embedding_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(entry_id, provider_name, model)
      DO UPDATE SET
        content_hash = excluded.content_hash,
        dimensions = excluded.dimensions,
        embedding_json = excluded.embedding_json,
        updated_at = excluded.updated_at`,
      [
        args.entryId,
        args.providerName,
        args.model,
        args.contentHash,
        args.embedding.length,
        JSON.stringify(args.embedding),
        now
      ]
    );
  }

  async listActiveEntriesWithEmbeddings(
    channel: string,
    chatId: string,
    providerName: string,
    model: string
  ): Promise<LongTermMemoryEntryWithEmbedding[]> {
    const rows = await this.db.all<Array<DBMemoryEntry & {
      emb_entry_id: number | null;
      emb_provider_name: string | null;
      emb_model: string | null;
      emb_content_hash: string | null;
      emb_dimensions: number | null;
      emb_embedding_json: string | null;
      emb_updated_at: string | null;
    }>[number]>(
      `SELECT
         me.*,
         emb.entry_id AS emb_entry_id,
         emb.provider_name AS emb_provider_name,
         emb.model AS emb_model,
         emb.content_hash AS emb_content_hash,
         emb.dimensions AS emb_dimensions,
         emb.embedding_json AS emb_embedding_json,
         emb.updated_at AS emb_updated_at
       FROM memory_entries me
       LEFT JOIN memory_embeddings emb
         ON emb.entry_id = me.id
        AND emb.provider_name = ?
        AND emb.model = ?
       WHERE me.channel = ?
         AND me.chat_id = ?
         AND me.status = 'active'
       ORDER BY me.confidence DESC, datetime(me.updated_at) DESC, me.id DESC`,
      [providerName, model, channel, chatId]
    );

    return rows.map((row) => ({
      entry: this.mapEntry(row),
      embedding: row.emb_entry_id === null
        ? undefined
        : this.mapEmbedding({
            entry_id: row.emb_entry_id,
            provider_name: row.emb_provider_name || providerName,
            model: row.emb_model || model,
            content_hash: row.emb_content_hash || '',
            dimensions: row.emb_dimensions || 0,
            embedding_json: row.emb_embedding_json || '[]',
            updated_at: row.emb_updated_at || ''
          })
    }));
  }

  private async getEntryRow(channel: string, chatId: string, entryId: number): Promise<DBMemoryEntry | undefined> {
    return this.db.get<DBMemoryEntry>(
      `SELECT *
       FROM memory_entries
       WHERE id = ? AND channel = ? AND chat_id = ?`,
      [entryId, channel, chatId]
    );
  }

  private async getEntryByContent(
    channel: string,
    chatId: string,
    content: string,
    excludeEntryId?: number
  ): Promise<DBMemoryEntry | undefined> {
    const params: Array<string | number> = [channel, chatId, content];
    let sql = `
      SELECT *
      FROM memory_entries
      WHERE channel = ?
        AND chat_id = ?
        AND content = ?
        AND status = 'active'
    `;

    if (typeof excludeEntryId === 'number') {
      sql += ' AND id != ?';
      params.push(excludeEntryId);
    }

    sql += ' ORDER BY confidence DESC, datetime(updated_at) DESC, id DESC LIMIT 1';
    return this.db.get<DBMemoryEntry>(sql, params);
  }

  private async insertOperation(args: {
    channel: string;
    chatId: string;
    entryId?: number;
    action: MemoryOperationAction;
    actor: MemoryOperationActor;
    reason?: string;
    before?: unknown;
    after?: unknown;
    evidence?: string[];
  }): Promise<void> {
    const createdAt = formatLocalTimestamp(new Date());
    await this.db.run(
      `INSERT INTO memory_operations (
        channel, chat_id, entry_id, action, actor, reason, before_json, after_json, evidence_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        args.channel,
        args.chatId,
        args.entryId ?? null,
        args.action,
        args.actor,
        args.reason || null,
        args.before === undefined ? null : JSON.stringify(args.before),
        args.after === undefined ? null : JSON.stringify(args.after),
        args.evidence && args.evidence.length > 0 ? JSON.stringify(args.evidence) : null,
        createdAt
      ]
    );
  }

  async applyOperation(
    channel: string,
    chatId: string,
    operation: MemoryOperationInput,
    actor: MemoryOperationActor
  ): Promise<MemoryOperationResult> {
    return this.db.transaction(async () => {
      const now = formatLocalTimestamp(new Date());
      const normalizedContent = this.normalizeContent(operation.content);
      const normalizedKind = this.normalizeKind(operation.kind);

      if (operation.action === 'create') {
        if (!normalizedContent) {
          throw new Error('create requires content');
        }

        const existingRow = await this.getEntryByContent(channel, chatId, normalizedContent);
        if (existingRow) {
          await this.db.run(
            `UPDATE memory_entries
             SET updated_at = ?,
                 last_seen_at = ?,
                 confidence = MIN(confidence + 1, ?),
                 confirmations = confirmations + 1
             WHERE id = ?`,
            [now, now, LongTermMemoryStore.MAX_CONFIDENCE, existingRow.id]
          );

          const refreshed = await this.getEntryRow(channel, chatId, existingRow.id);
          const entry = this.mapEntry(refreshed || existingRow);
          await this.insertOperation({
            channel,
            chatId,
            entryId: entry.id,
            action: 'update',
            actor,
            reason: operation.reason || 'Duplicate content refreshed existing memory entry',
            before: this.mapEntry(existingRow),
            after: entry,
            evidence: operation.evidence
          });
          return { action: 'update', entry, changed: true };
        }

        const result = await this.db.run(
          `INSERT INTO memory_entries (
            channel, chat_id, kind, content, status, confidence, confirmations, created_at, updated_at, last_seen_at
          ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
          [channel, chatId, normalizedKind, normalizedContent, 1, 1, now, now, now]
        );
        const row = await this.getEntryRow(channel, chatId, result.lastID);
        if (!row) {
          throw new Error('created memory entry not found');
        }

        const entry = this.mapEntry(row);
        await this.insertOperation({
          channel,
          chatId,
          entryId: entry.id,
          action: 'create',
          actor,
          reason: operation.reason,
          after: entry,
          evidence: operation.evidence
        });
        return { action: 'create', entry, changed: true };
      }

      if (typeof operation.entryId !== 'number' || !Number.isFinite(operation.entryId)) {
        throw new Error(`${operation.action} requires entryId`);
      }

      const targetRow = await this.getEntryRow(channel, chatId, operation.entryId);
      if (!targetRow || targetRow.status === 'deleted') {
        throw new Error(`memory entry not found: ${operation.entryId}`);
      }

      if (operation.action === 'update') {
        const nextContent = normalizedContent || targetRow.content;
        const nextKind = operation.kind ? normalizedKind : (targetRow.kind as MemoryEntryKind);
        const duplicate = await this.getEntryByContent(channel, chatId, nextContent, targetRow.id);

        if (duplicate) {
          await this.db.run(
            `UPDATE memory_entries
             SET updated_at = ?,
                 last_seen_at = ?,
                 confidence = MIN(confidence + 1, ?),
                 confirmations = confirmations + 1
             WHERE id = ?`,
            [now, now, LongTermMemoryStore.MAX_CONFIDENCE, duplicate.id]
          );
          await this.db.run(
            `UPDATE memory_entries
             SET status = 'archived',
                 updated_at = ?
             WHERE id = ?`,
            [now, targetRow.id]
          );

          const refreshedDuplicate = await this.getEntryRow(channel, chatId, duplicate.id);
          const entry = this.mapEntry(refreshedDuplicate || duplicate);
          await this.insertOperation({
            channel,
            chatId,
            entryId: entry.id,
            action: 'merge',
            actor,
            reason: operation.reason || 'Updated content matched existing active memory entry',
            before: {
              target: this.mapEntry(targetRow),
              duplicate: this.mapEntry(duplicate)
            },
            after: entry,
            evidence: operation.evidence
          });
          return { action: 'merge', entry, changed: true };
        }

        await this.db.run(
          `UPDATE memory_entries
           SET kind = ?,
               content = ?,
               updated_at = ?,
               last_seen_at = ?,
               confidence = MIN(confidence + 1, ?),
               confirmations = confirmations + 1
           WHERE id = ?`,
          [nextKind, nextContent, now, now, LongTermMemoryStore.MAX_CONFIDENCE, targetRow.id]
        );

        const refreshed = await this.getEntryRow(channel, chatId, targetRow.id);
        const entry = this.mapEntry(refreshed || targetRow);
        await this.insertOperation({
          channel,
          chatId,
          entryId: entry.id,
          action: 'update',
          actor,
          reason: operation.reason,
          before: this.mapEntry(targetRow),
          after: entry,
          evidence: operation.evidence
        });
        return { action: 'update', entry, changed: true };
      }

      if (operation.action === 'archive' || operation.action === 'delete') {
        const nextStatus: MemoryEntryStatus = operation.action === 'archive' ? 'archived' : 'deleted';
        if (targetRow.status === nextStatus) {
          return {
            action: operation.action,
            entry: this.mapEntry(targetRow),
            changed: false
          };
        }

        await this.db.run(
          `UPDATE memory_entries
           SET status = ?, updated_at = ?
           WHERE id = ?`,
          [nextStatus, now, targetRow.id]
        );

        const refreshed = await this.getEntryRow(channel, chatId, targetRow.id);
        const entry = this.mapEntry(refreshed || targetRow);
        await this.insertOperation({
          channel,
          chatId,
          entryId: entry.id,
          action: operation.action,
          actor,
          reason: operation.reason,
          before: this.mapEntry(targetRow),
          after: entry,
          evidence: operation.evidence
        });
        return { action: operation.action, entry, changed: true };
      }

      if (operation.action === 'merge') {
        const sourceIds = Array.isArray(operation.sourceIds)
          ? Array.from(new Set(operation.sourceIds.filter((id): id is number => Number.isFinite(id) && id !== targetRow.id)))
          : [];
        if (sourceIds.length === 0) {
          throw new Error('merge requires sourceIds');
        }

        const sourceRows = await Promise.all(sourceIds.map((sourceId) => this.getEntryRow(channel, chatId, sourceId)));
        const validSources = sourceRows.filter((row): row is DBMemoryEntry => !!row && row.status !== 'deleted');
        if (validSources.length === 0) {
          throw new Error('merge sources not found');
        }

        const nextContent = normalizedContent || targetRow.content;
        const nextKind = operation.kind ? normalizedKind : (targetRow.kind as MemoryEntryKind);

        for (const sourceRow of validSources) {
          await this.db.run(
            `UPDATE memory_entries
             SET status = 'archived',
                 updated_at = ?
             WHERE id = ?`,
            [now, sourceRow.id]
          );
        }

        await this.db.run(
          `UPDATE memory_entries
           SET kind = ?,
               content = ?,
               status = 'active',
               updated_at = ?,
               last_seen_at = ?,
               confidence = MIN(confidence + 1, ?),
               confirmations = confirmations + 1
           WHERE id = ?`,
          [nextKind, nextContent, now, now, LongTermMemoryStore.MAX_CONFIDENCE, targetRow.id]
        );

        const refreshed = await this.getEntryRow(channel, chatId, targetRow.id);
        const entry = this.mapEntry(refreshed || targetRow);
        await this.insertOperation({
          channel,
          chatId,
          entryId: entry.id,
          action: 'merge',
          actor,
          reason: operation.reason,
          before: {
            target: this.mapEntry(targetRow),
            sources: validSources.map((row) => this.mapEntry(row))
          },
          after: entry,
          evidence: operation.evidence
        });
        return { action: 'merge', entry, changed: true };
      }

      throw new Error(`unsupported memory action: ${operation.action}`);
    });
  }

  async deleteConversationEntries(channel: string, chatId: string, actor: MemoryOperationActor, reason: string): Promise<number> {
    const entries = await this.listEntries(channel, chatId, { statuses: ['active', 'archived'] });
    let changed = 0;

    for (const entry of entries) {
      const result = await this.applyOperation(channel, chatId, {
        action: 'delete',
        entryId: entry.id,
        reason
      }, actor);
      if (result.changed) {
        changed += 1;
      }
    }

    return changed;
  }

  async deleteAllEntries(actor: MemoryOperationActor, reason: string): Promise<number> {
    const rows = await this.db.all<Pick<DBMemoryEntry, 'channel' | 'chat_id' | 'id'>>(
      `SELECT id, channel, chat_id
       FROM memory_entries
       WHERE status IN ('active', 'archived')
       ORDER BY id ASC`
    );

    let changed = 0;
    for (const row of rows) {
      const result = await this.applyOperation(row.channel, row.chat_id, {
        action: 'delete',
        entryId: row.id,
        reason
      }, actor);
      if (result.changed) {
        changed += 1;
      }
    }

    return changed;
  }
}
