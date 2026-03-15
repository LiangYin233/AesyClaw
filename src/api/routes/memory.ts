import type { Express } from 'express';
import { createErrorResponse, normalizeError, NotFoundError } from '../../errors/index.js';
import { INTERNAL_CHANNELS } from '../../constants/index.js';
import type { SessionManager } from '../../session/SessionManager.js';
import type { MemoryFactStore } from '../../session/MemoryFactStore.js';

interface MemoryRouteDeps {
  sessionManager: SessionManager;
  memoryFactStore?: MemoryFactStore;
  log: {
    error(message: string, ...args: any[]): void;
  };
}

export function registerMemoryRoutes(app: Express, deps: MemoryRouteDeps): void {
  app.get('/api/memory', async (req, res) => {
    try {
      const db = deps.sessionManager.getDatabase();
      await db.ready();

      const [sessionRows, factRows, conversationRows] = await Promise.all([
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
          channel: string;
          chat_id: string;
          fact: string;
          updated_at: string;
        }>(
          `SELECT channel, chat_id, fact, updated_at
           FROM memory_facts
           WHERE channel != ?
           ORDER BY datetime(updated_at) DESC, id DESC`,
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

      const factsByConversation = new Map<string, { facts: string[]; updatedAt?: string }>();

      for (const row of factRows) {
        const conversationKey = `${row.channel}:${row.chat_id}`;
        const current = factsByConversation.get(conversationKey) || { facts: [], updatedAt: row.updated_at };
        current.facts.push(row.fact);
        current.updatedAt = [current.updatedAt, row.updated_at]
          .filter((value): value is string => Boolean(value))
          .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0];
        factsByConversation.set(conversationKey, current);
      }

      const getLatestTimestamp = (...values: Array<string | null | undefined>): string | undefined => {
        const timestamps = values.filter((value): value is string => Boolean(value));

        if (timestamps.length === 0) {
          return undefined;
        }

        return timestamps.sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0];
      };

      const conversationMap = new Map<string, {
        key: string;
        channel: string;
        chatId: string;
        facts: string[];
        factCount: number;
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
        const existing = conversationMap.get(conversationKey) || {
          key: `memory:${conversationKey}`,
          channel: row.channel,
          chatId: row.chat_id,
          facts: factsByConversation.get(conversationKey)?.facts || [],
          factCount: factsByConversation.get(conversationKey)?.facts.length || 0,
          sessionCount: 0,
          summaryCount: 0,
          sessions: [],
          updatedAt: factsByConversation.get(conversationKey)?.updatedAt
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
        const existing = conversationMap.get(conversationKey) || {
          key: `memory:${conversationKey}`,
          channel: row.channel,
          chatId: row.chat_id,
          facts: factsByConversation.get(conversationKey)?.facts || [],
          factCount: factsByConversation.get(conversationKey)?.facts.length || 0,
          sessionCount: 0,
          summaryCount: 0,
          conversationSummary: undefined,
          conversationSummarizedUntilMessageId: undefined,
          sessions: [],
          updatedAt: factsByConversation.get(conversationKey)?.updatedAt
        };

        if (row.summary.trim()) {
          existing.summaryCount += 1;
          existing.conversationSummary = row.summary;
          existing.conversationSummarizedUntilMessageId = row.summarized_until_message_id;
        }
        existing.updatedAt = getLatestTimestamp(existing.updatedAt, row.updated_at);
        conversationMap.set(conversationKey, existing);
      }

      for (const [conversationKey, factData] of factsByConversation.entries()) {
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
          facts: factData.facts,
          factCount: factData.facts.length,
          sessionCount: 0,
          summaryCount: 0,
          sessions: [],
          updatedAt: factData.updatedAt
        });
      }

      const items = Array.from(conversationMap.values())
        .filter((item) => item.factCount > 0 || item.summaryCount > 0)
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
      deps.log.error(`Memory list error: ${normalizeError(error)}`);
      res.status(500).json(createErrorResponse(error));
    }
  });

  app.delete('/api/memory/:key', async (req, res) => {
    try {
      const db = deps.sessionManager.getDatabase();
      await db.ready();

      const rawKey = decodeURIComponent(req.params.key);
      let channel: string | undefined;
      let chatId: string | undefined;

      const sessionRow = await db.get<{
        key: string;
        channel: string;
        chat_id: string;
      }>(`SELECT key, channel, chat_id FROM sessions WHERE key = ?`, [rawKey]);

      if (sessionRow) {
        channel = sessionRow.channel;
        chatId = sessionRow.chat_id;
        await deps.sessionManager.clearSummary(sessionRow.key);
      } else if (rawKey.startsWith('memory:')) {
        const conversationKey = rawKey.slice('memory:'.length);
        const separatorIndex = conversationKey.indexOf(':');

        if (separatorIndex > 0) {
          channel = conversationKey.slice(0, separatorIndex);
          chatId = conversationKey.slice(separatorIndex + 1);
          await deps.sessionManager.clearConversationSummaries(channel, chatId);
        }
      }

      if (!channel || !chatId) {
        throw new NotFoundError('Memory entry', rawKey);
      }

      if (deps.memoryFactStore) {
        await deps.memoryFactStore.clearFacts(channel, chatId);
      } else {
        await db.run(`DELETE FROM memory_facts WHERE channel = ? AND chat_id = ?`, [channel, chatId]);
      }

      res.json({ success: true });
    } catch (error: unknown) {
      deps.log.error(`Memory delete error: ${normalizeError(error)}`);

      if (error instanceof NotFoundError) {
        return res.status(404).json(createErrorResponse(error));
      }

      res.status(500).json(createErrorResponse(error));
    }
  });

  app.delete('/api/memory', async (req, res) => {
    try {
      await deps.sessionManager.clearAllSummaries();

      if (deps.memoryFactStore) {
        await deps.memoryFactStore.clearAllFacts();
      } else {
        const db = deps.sessionManager.getDatabase();
        await db.ready();
        await db.run(`DELETE FROM memory_facts`);
      }

      res.json({ success: true });
    } catch (error: unknown) {
      deps.log.error(`Memory clear-all error: ${normalizeError(error)}`);
      res.status(500).json(createErrorResponse(error));
    }
  });
}
