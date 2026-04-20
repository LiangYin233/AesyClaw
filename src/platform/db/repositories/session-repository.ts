import { logger } from '@/platform/observability/logger.js';
import { sqliteManager } from '../sqlite-manager.js';
import { MessageRole, type StandardMessage } from '@/platform/llm/types.js';

export interface ChatKey {
  channel: string;
  type: string;
  chatId: string;
}

export interface ChatSession {
  channel: string;
  type: string;
  chatId: string;
  roleId: string;
}

export interface ReplaceMessagesInput {
  role: MessageRole;
  content: string;
  toolCalls?: StandardMessage['toolCalls'];
  toolCallId?: string;
  name?: string;
}

class ChatStore {
  count(): number {
    const row = sqliteManager.getDatabase()
      .prepare('SELECT COUNT(*) as cnt FROM chat_sessions')
      .get() as { cnt: number };
    return row.cnt;
  }

  get(key: ChatKey): ChatSession | null {
    const row = sqliteManager.getDatabase()
      .prepare('SELECT * FROM chat_sessions WHERE channel = ? AND type = ? AND chat_id = ?')
      .get(key.channel, key.type, key.chatId) as {
        channel: string;
        type: string;
        chat_id: string;
        role_id: string;
      } | undefined;

    if (!row) {return null;}
    return {
      channel: row.channel,
      type: row.type,
      chatId: row.chat_id,
      roleId: row.role_id,
    };
  }

  create(key: ChatKey): ChatSession {
    sqliteManager.getDatabase()
      .prepare('INSERT INTO chat_sessions (channel, type, chat_id, role_id) VALUES (?, ?, ?, ?)')
      .run(key.channel, key.type, key.chatId, 'default');

    logger.info({ channel: key.channel, type: key.type, chatId: key.chatId }, 'Chat session created');
    return { ...key, roleId: 'default' };
  }

  updateRole(key: ChatKey, roleId: string): void {
    sqliteManager.getDatabase()
      .prepare('UPDATE chat_sessions SET role_id = ? WHERE channel = ? AND type = ? AND chat_id = ?')
      .run(roleId, key.channel, key.type, key.chatId);

    logger.info({ channel: key.channel, type: key.type, chatId: key.chatId, roleId }, 'Chat role updated');
  }

  getMessages(key: ChatKey): StandardMessage[] {
    const rows = sqliteManager.getDatabase()
      .prepare(
        'SELECT * FROM chat_messages WHERE channel = ? AND type = ? AND chat_id = ? ORDER BY sequence ASC'
      )
      .all(key.channel, key.type, key.chatId) as Array<{
        role: string;
        content: string;
        tool_calls: string | null;
        tool_call_id: string | null;
        name: string | null;
      }>;

    return rows.map(row => {
      let toolCalls: StandardMessage['toolCalls'] | undefined;
      if (row.tool_calls) {
        try {
          toolCalls = JSON.parse(row.tool_calls) as StandardMessage['toolCalls'];
        } catch {
          logger.warn({ channel: key.channel, type: key.type, chatId: key.chatId }, 'Failed to parse tool_calls JSON, skipping');
        }
      }
      return {
        role: row.role as MessageRole,
        content: row.content,
        toolCalls,
        toolCallId: row.tool_call_id || undefined,
        name: row.name || undefined,
      };
    });
  }

  saveMessages(key: ChatKey, messages: StandardMessage[]): void {
    const db = sqliteManager.getDatabase();

    sqliteManager.transaction(() => {
      db.prepare('DELETE FROM chat_messages WHERE channel = ? AND type = ? AND chat_id = ?')
        .run(key.channel, key.type, key.chatId);

      if (messages.length === 0) {
        return;
      }

      const stmt = db.prepare(`
        INSERT INTO chat_messages (channel, type, chat_id, sequence, role, content, tool_calls, tool_call_id, name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const [index, message] of messages.entries()) {
        stmt.run(
          key.channel,
          key.type,
          key.chatId,
          index,
          message.role,
          message.content,
          message.toolCalls ? JSON.stringify(message.toolCalls) : null,
          message.toolCallId || null,
          message.name || null
        );
      }
    });

    logger.debug(
      { channel: key.channel, type: key.type, chatId: key.chatId, count: messages.length },
      'Chat messages saved'
    );
  }
}

export const chatStore = new ChatStore();
