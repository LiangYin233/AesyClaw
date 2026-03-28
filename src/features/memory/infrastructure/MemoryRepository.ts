import type { Database } from '../../../platform/db/index.js';
import type { SessionManager } from '../../../agent/infrastructure/session/SessionManager.js';
import type {
  LongTermMemoryOperation,
  LongTermMemoryStore
} from '../../../agent/infrastructure/memory/LongTermMemoryStore.js';

const CRON_CHANNEL = 'cron';

export class MemoryRepository {
  constructor(
    private readonly sessionManager: SessionManager,
    private readonly longTermMemoryStore: LongTermMemoryStore,
    private readonly db: Database
  ) {}

  async listMemoryRows(): Promise<{
    sessionRows: Array<{
      key: string;
      channel: string;
      chat_id: string;
      uuid: string | null;
      summary: string;
      summarized_message_count: number;
      session_updated_at: string;
      summary_updated_at: string | null;
    }>;
    entryRows: Array<{
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
    }>;
    operationRows: Array<{
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
    }>;
    conversationRows: Array<{
      channel: string;
      chat_id: string;
      summary: string;
      summarized_until_message_id: number;
      updated_at: string;
    }>;
  }> {
    const db = this.db;
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
        [CRON_CHANNEL]
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
        [CRON_CHANNEL]
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
        [CRON_CHANNEL]
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
        [CRON_CHANNEL]
      )
    ]);

    return {
      sessionRows,
      entryRows,
      operationRows,
      conversationRows
    };
  }

  async resolveConversationTarget(rawKey: string): Promise<{ channel: string; chatId: string } | null> {
    const db = this.db;
    const sessionRow = await db.get<{
      key: string;
      channel: string;
      chat_id: string;
    }>('SELECT key, channel, chat_id FROM sessions WHERE key = ?', [rawKey]);

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

    return null;
  }

  async listOperations(channel: string, chatId: string, limit: number): Promise<LongTermMemoryOperation[]> {
    return this.longTermMemoryStore.listOperations(channel, chatId, limit);
  }

  async clearConversation(channel: string, chatId: string): Promise<number> {
    await this.sessionManager.clearConversationSummaries(channel, chatId);
    return this.longTermMemoryStore.deleteConversationEntries(
      channel,
      chatId,
      'api',
      'Cleared from memory API'
    );
  }

  async clearAll(): Promise<number> {
    await this.sessionManager.clearAllSummaries();
    return this.longTermMemoryStore.deleteAllEntries('api', 'Cleared all memory from memory API');
  }
}
