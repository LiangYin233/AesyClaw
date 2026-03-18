import type { Express } from 'express';
import { createErrorResponse, normalizeError, NotFoundError } from '../../errors/index.js';
import { INTERNAL_CHANNELS } from '../../constants/index.js';
import type { SessionManager } from '../../session/SessionManager.js';
import type { LongTermMemoryStore } from '../../session/LongTermMemoryStore.js';

interface MemoryRouteDeps {
  sessionManager: SessionManager;
  longTermMemoryStore: LongTermMemoryStore;
  log: {
    error(message: string, ...args: any[]): void;
  };
}

function parseJson<T>(value?: string | null): T | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

async function resolveConversationTarget(sessionManager: SessionManager, rawKey: string): Promise<{
  channel: string;
  chatId: string;
}> {
  const db = sessionManager.getDatabase();
  const sessionRow = await db.get<{
    key: string;
    channel: string;
    chat_id: string;
  }>(`SELECT key, channel, chat_id FROM sessions WHERE key = ?`, [rawKey]);

  if (sessionRow) {
    return {
      channel: sessionRow.channel,
      chatId: sessionRow.chat_id
    };
  }

  if (rawKey.startsWith('memory:')) {
    const conversationKey = rawKey.slice('memory:'.length);
    const separatorIndex = conversationKey.indexOf(':');
    if (separatorIndex > 0) {
      return {
        channel: conversationKey.slice(0, separatorIndex),
        chatId: conversationKey.slice(separatorIndex + 1)
      };
    }
  }

  throw new NotFoundError('Memory entry', rawKey);
}

export function registerMemoryRoutes(app: Express, deps: MemoryRouteDeps): void {
  app.get('/api/memory', async (_req, res) => {
    try {
      const db = deps.sessionManager.getDatabase();
      await db.ready();

      const [sessionRows, entryRows, operationRows, conversationRows] = await Promise.all([
        db.all<{
          key: string;
          channel: string;
          chat_id: string;
          uuid: string | null;
          summary: string;
          summarized_message_count: number;
          session_updated_at: string;
          summary_updated_at: string | null;
        }>(
          `SELECT
            s.key,
            s.channel,
            s.chat_id,
            s.uuid,
            s.updated_at as session_updated_at,
            COALESCE(sm.summary, '') as summary,
            COALESCE(sm.summarized_message_count, 0) as summarized_message_count,
            sm.updated_at as summary_updated_at
          FROM sessions s
          LEFT JOIN session_memory sm ON sm.session_id = s.id
          WHERE s.channel != ?
          ORDER BY datetime(s.updated_at) DESC`,
          [INTERNAL_CHANNELS.CRON]
        ),
        db.all<{
          id: number;
          channel: string;
          chat_id: string;
          kind: string;
          content: string;
          status: string;
          confidence: number;
          confirmations: number;
          created_at: string;
          updated_at: string;
          last_seen_at: string;
        }>(
          `SELECT *
           FROM memory_entries
           WHERE channel != ?
             AND status != 'deleted'
           ORDER BY datetime(updated_at) DESC, id DESC`,
          [INTERNAL_CHANNELS.CRON]
        ),
        db.all<{
          id: number;
          channel: string;
          chat_id: string;
          entry_id: number | null;
          action: string;
          actor: string;
          reason: string | null;
          before_json: string | null;
          after_json: string | null;
          evidence_json: string | null;
          created_at: string;
        }>(
          `SELECT *
           FROM memory_operations
           WHERE channel != ?
           ORDER BY datetime(created_at) DESC, id DESC`,
          [INTERNAL_CHANNELS.CRON]
        ),
        db.all<{
          channel: string;
          chat_id: string;
          summary: string;
          summarized_until_message_id: number;
          updated_at: string;
        }>(
          `SELECT channel, chat_id, summary, summarized_until_message_id, updated_at
           FROM conversation_memory
           WHERE channel != ?
           ORDER BY datetime(updated_at) DESC`,
          [INTERNAL_CHANNELS.CRON]
        )
      ]);

      const getLatestTimestamp = (...values: Array<string | null | undefined>): string | undefined => {
        const timestamps = values.filter((value): value is string => Boolean(value));
        if (timestamps.length === 0) {
          return undefined;
        }

        return timestamps.sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0];
      };

      const entriesByConversation = new Map<string, Array<{
        id: number;
        kind: string;
        content: string;
        status: string;
        confidence: number;
        confirmations: number;
        createdAt?: string;
        updatedAt?: string;
        lastSeenAt?: string;
      }>>();

      for (const row of entryRows) {
        const key = `${row.channel}:${row.chat_id}`;
        const bucket = entriesByConversation.get(key) || [];
        bucket.push({
          id: row.id,
          kind: row.kind,
          content: row.content,
          status: row.status,
          confidence: row.confidence,
          confirmations: row.confirmations,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          lastSeenAt: row.last_seen_at
        });
        entriesByConversation.set(key, bucket);
      }

      const operationsByConversation = new Map<string, Array<{
        id: number;
        entryId?: number;
        action: string;
        actor: string;
        reason?: string;
        before?: unknown;
        after?: unknown;
        evidence: string[];
        createdAt?: string;
      }>>();

      for (const row of operationRows) {
        const key = `${row.channel}:${row.chat_id}`;
        const bucket = operationsByConversation.get(key) || [];
        if (bucket.length >= 20) {
          continue;
        }

        bucket.push({
          id: row.id,
          entryId: row.entry_id ?? undefined,
          action: row.action,
          actor: row.actor,
          reason: row.reason || undefined,
          before: parseJson(row.before_json),
          after: parseJson(row.after_json),
          evidence: parseJson<string[]>(row.evidence_json) || [],
          createdAt: row.created_at
        });
        operationsByConversation.set(key, bucket);
      }

      const conversationMap = new Map<string, {
        key: string;
        channel: string;
        chatId: string;
        activeEntryCount: number;
        entries: Array<{
          id: number;
          kind: string;
          content: string;
          status: string;
          confidence: number;
          confirmations: number;
          createdAt?: string;
          updatedAt?: string;
          lastSeenAt?: string;
        }>;
        recentOperations: Array<{
          id: number;
          entryId?: number;
          action: string;
          actor: string;
          reason?: string;
          before?: unknown;
          after?: unknown;
          evidence: string[];
          createdAt?: string;
        }>;
        sessionCount: number;
        summaryCount: number;
        conversationSummary?: string;
        conversationSummarizedUntilMessageId?: number;
        sessions: Array<{
          sessionKey: string;
          uuid?: string;
          summary: string;
          summarizedMessageCount: number;
          updatedAt?: string;
        }>;
        updatedAt?: string;
      }>();

      for (const row of sessionRows) {
        const conversationKey = `${row.channel}:${row.chat_id}`;
        const existingEntries = entriesByConversation.get(conversationKey) || [];
        const existing = conversationMap.get(conversationKey) || {
          key: `memory:${conversationKey}`,
          channel: row.channel,
          chatId: row.chat_id,
          activeEntryCount: existingEntries.filter((entry) => entry.status === 'active').length,
          entries: existingEntries,
          recentOperations: operationsByConversation.get(conversationKey) || [],
          sessionCount: 0,
          summaryCount: 0,
          sessions: [],
          updatedAt: getLatestTimestamp(
            ...existingEntries.map((entry) => entry.updatedAt),
            ...(operationsByConversation.get(conversationKey) || []).map((operation) => operation.createdAt)
          )
        };

        existing.sessionCount += 1;
        if (row.summary.trim()) {
          existing.summaryCount += 1;
        }
        existing.sessions.push({
          sessionKey: row.key,
          uuid: row.uuid || undefined,
          summary: row.summary,
          summarizedMessageCount: row.summarized_message_count,
          updatedAt: getLatestTimestamp(row.summary_updated_at, row.session_updated_at)
        });
        existing.updatedAt = getLatestTimestamp(existing.updatedAt, row.summary_updated_at, row.session_updated_at);
        conversationMap.set(conversationKey, existing);
      }

      for (const row of conversationRows) {
        const conversationKey = `${row.channel}:${row.chat_id}`;
        const existingEntries = entriesByConversation.get(conversationKey) || [];
        const existing = conversationMap.get(conversationKey) || {
          key: `memory:${conversationKey}`,
          channel: row.channel,
          chatId: row.chat_id,
          activeEntryCount: existingEntries.filter((entry) => entry.status === 'active').length,
          entries: existingEntries,
          recentOperations: operationsByConversation.get(conversationKey) || [],
          sessionCount: 0,
          summaryCount: 0,
          sessions: [],
          updatedAt: getLatestTimestamp(
            ...existingEntries.map((entry) => entry.updatedAt),
            ...(operationsByConversation.get(conversationKey) || []).map((operation) => operation.createdAt)
          )
        };

        if (row.summary.trim()) {
          existing.summaryCount += 1;
          existing.conversationSummary = row.summary;
          existing.conversationSummarizedUntilMessageId = row.summarized_until_message_id;
        }
        existing.updatedAt = getLatestTimestamp(existing.updatedAt, row.updated_at);
        conversationMap.set(conversationKey, existing);
      }

      for (const [conversationKey, entries] of entriesByConversation.entries()) {
        if (conversationMap.has(conversationKey)) {
          continue;
        }

        const separatorIndex = conversationKey.indexOf(':');
        const channel = conversationKey.slice(0, separatorIndex);
        const chatId = conversationKey.slice(separatorIndex + 1);
        conversationMap.set(conversationKey, {
          key: `memory:${conversationKey}`,
          channel,
          chatId,
          activeEntryCount: entries.filter((entry) => entry.status === 'active').length,
          entries,
          recentOperations: operationsByConversation.get(conversationKey) || [],
          sessionCount: 0,
          summaryCount: 0,
          sessions: [],
          updatedAt: getLatestTimestamp(
            ...entries.map((entry) => entry.updatedAt),
            ...(operationsByConversation.get(conversationKey) || []).map((operation) => operation.createdAt)
          )
        });
      }

      const items = Array.from(conversationMap.values())
        .filter((item) => item.activeEntryCount > 0 || item.summaryCount > 0 || item.entries.length > 0 || item.recentOperations.length > 0)
        .map((item) => ({
          ...item,
          sessions: item.sessions.sort((left, right) => {
            const leftTime = left.updatedAt ? new Date(left.updatedAt).getTime() : 0;
            const rightTime = right.updatedAt ? new Date(right.updatedAt).getTime() : 0;
            return rightTime - leftTime;
          })
        }));

      items.sort((left, right) => {
        const leftTime = left.updatedAt ? new Date(left.updatedAt).getTime() : 0;
        const rightTime = right.updatedAt ? new Date(right.updatedAt).getTime() : 0;
        return rightTime - leftTime;
      });

      res.json({ items });
    } catch (error: unknown) {
      deps.log.error(`记忆列表加载失败: ${normalizeError(error)}`);
      res.status(500).json(createErrorResponse(error));
    }
  });

  app.get('/api/memory/:key/history', async (req, res) => {
    try {
      const rawKey = decodeURIComponent(req.params.key);
      const { channel, chatId } = await resolveConversationTarget(deps.sessionManager, rawKey);
      const items = await deps.longTermMemoryStore.listOperations(channel, chatId, 100);
      res.json({ items });
    } catch (error: unknown) {
      deps.log.error(`记忆历史加载失败: ${normalizeError(error)}`);
      if (error instanceof NotFoundError) {
        res.status(404).json(createErrorResponse(error));
        return;
      }
      res.status(500).json(createErrorResponse(error));
    }
  });

  app.delete('/api/memory/:key', async (req, res) => {
    try {
      const rawKey = decodeURIComponent(req.params.key);
      const { channel, chatId } = await resolveConversationTarget(deps.sessionManager, rawKey);

      await deps.sessionManager.clearConversationSummaries(channel, chatId);
      const deletedCount = await deps.longTermMemoryStore.deleteConversationEntries(
        channel,
        chatId,
        'api',
        'Cleared from memory API'
      );

      res.json({ success: true, deletedCount });
    } catch (error: unknown) {
      deps.log.error(`记忆删除失败: ${normalizeError(error)}`);

      if (error instanceof NotFoundError) {
        res.status(404).json(createErrorResponse(error));
        return;
      }

      res.status(500).json(createErrorResponse(error));
    }
  });

  app.delete('/api/memory', async (_req, res) => {
    try {
      await deps.sessionManager.clearAllSummaries();
      const deletedCount = await deps.longTermMemoryStore.deleteAllEntries('api', 'Cleared all memory from memory API');
      res.json({ success: true, deletedCount });
    } catch (error: unknown) {
      deps.log.error(`清空全部记忆失败: ${normalizeError(error)}`);
      res.status(500).json(createErrorResponse(error));
    }
  });
}
