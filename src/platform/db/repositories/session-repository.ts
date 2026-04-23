import { logger } from '@/platform/observability/logger.js';
import { sqliteManager } from '../sqlite-manager.js';
import { MessageRole } from '@/platform/llm/types.js';
import type { AgentMessage } from '@mariozechner/pi-agent-core';

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

/** 数据库消息记录格式（内部序列化类型） */
interface ChatMessageRecord {
    role: MessageRole;
    content: string;
    toolCalls?: { id: string; name: string; arguments: Record<string, unknown> }[];
    toolCallId?: string;
    name?: string;
}

/** 将 AgentMessage 序列化为数据库记录 */
function serializeAgentMessage(message: AgentMessage): ChatMessageRecord {
    if (message.role === 'user') {
        return {
            role: MessageRole.User,
            content: typeof message.content === 'string' ? message.content : '',
        };
    }

    if (message.role === 'assistant') {
        const textParts = message.content
            .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
            .map((c) => c.text);
        const toolCalls = message.content
            .filter(
                (
                    c,
                ): c is {
                    type: 'toolCall';
                    id: string;
                    name: string;
                    arguments: Record<string, unknown>;
                } => c.type === 'toolCall',
            )
            .map((c) => ({ id: c.id, name: c.name, arguments: c.arguments }));

        return {
            role: MessageRole.Assistant,
            content: textParts.join(''),
            ...(toolCalls.length > 0 ? { toolCalls } : {}),
        };
    }

    if (message.role === 'toolResult') {
        const textParts = message.content
            .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
            .map((c) => c.text);

        return {
            role: MessageRole.Tool,
            content: textParts.join(''),
            toolCallId: message.toolCallId,
            name: message.toolName,
        };
    }

    return { role: MessageRole.User, content: '' };
}

/** 将数据库记录反序列化为 AgentMessage */
function deserializeAgentMessage(record: ChatMessageRecord): AgentMessage {
    const timestamp = Date.now();

    if (record.role === MessageRole.User) {
        return { role: 'user', content: record.content, timestamp };
    }

    if (record.role === MessageRole.Assistant) {
        const content: Array<
            | { type: 'text'; text: string }
            | { type: 'toolCall'; id: string; name: string; arguments: Record<string, unknown> }
        > = [{ type: 'text', text: record.content }];
        if (record.toolCalls) {
            for (const tc of record.toolCalls) {
                content.push({
                    type: 'toolCall',
                    id: tc.id,
                    name: tc.name,
                    arguments: tc.arguments,
                });
            }
        }
        return {
            role: 'assistant',
            content,
            api: 'openai-responses',
            provider: 'openai',
            model: '',
            usage: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 0,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: 'stop',
            timestamp,
        };
    }

    if (record.role === MessageRole.Tool) {
        return {
            role: 'toolResult',
            toolCallId: record.toolCallId || '',
            toolName: record.name || '',
            content: [{ type: 'text', text: record.content }],
            isError: false,
            timestamp,
        };
    }

    return { role: 'user', content: record.content, timestamp };
}

class ChatStore {
    count(): number {
        const row = sqliteManager
            .getDatabase()
            .prepare('SELECT COUNT(*) as cnt FROM chat_sessions')
            .get() as { cnt: number };
        return row.cnt;
    }

    get(key: ChatKey): ChatSession | null {
        const row = sqliteManager
            .getDatabase()
            .prepare('SELECT * FROM chat_sessions WHERE channel = ? AND type = ? AND chat_id = ?')
            .get(key.channel, key.type, key.chatId) as
            | {
                  channel: string;
                  type: string;
                  chat_id: string;
                  role_id: string;
              }
            | undefined;

        if (!row) {
            return null;
        }
        return {
            channel: row.channel,
            type: row.type,
            chatId: row.chat_id,
            roleId: row.role_id,
        };
    }

    create(key: ChatKey): ChatSession {
        sqliteManager
            .getDatabase()
            .prepare(
                'INSERT INTO chat_sessions (channel, type, chat_id, role_id) VALUES (?, ?, ?, ?)',
            )
            .run(key.channel, key.type, key.chatId, 'default');

        logger.info(
            { channel: key.channel, type: key.type, chatId: key.chatId },
            'Chat session created',
        );
        return { ...key, roleId: 'default' };
    }

    updateRole(key: ChatKey, roleId: string): void {
        sqliteManager
            .getDatabase()
            .prepare(
                'UPDATE chat_sessions SET role_id = ? WHERE channel = ? AND type = ? AND chat_id = ?',
            )
            .run(roleId, key.channel, key.type, key.chatId);

        logger.info(
            { channel: key.channel, type: key.type, chatId: key.chatId, roleId },
            'Chat role updated',
        );
    }

    getMessages(key: ChatKey): AgentMessage[] {
        const rows = sqliteManager
            .getDatabase()
            .prepare(
                'SELECT * FROM chat_messages WHERE channel = ? AND type = ? AND chat_id = ? ORDER BY sequence ASC',
            )
            .all(key.channel, key.type, key.chatId) as Array<{
            role: string;
            content: string;
            tool_calls: string | null;
            tool_call_id: string | null;
            name: string | null;
        }>;

        return rows.map((row) => {
            let toolCalls: ChatMessageRecord['toolCalls'] | undefined;
            if (row.tool_calls) {
                try {
                    toolCalls = JSON.parse(row.tool_calls) as ChatMessageRecord['toolCalls'];
                } catch {
                    logger.warn(
                        { channel: key.channel, type: key.type, chatId: key.chatId },
                        'Failed to parse tool_calls JSON, skipping',
                    );
                }
            }
            const record: ChatMessageRecord = {
                role: row.role as MessageRole,
                content: row.content,
                toolCalls,
                toolCallId: row.tool_call_id || undefined,
                name: row.name || undefined,
            };
            return deserializeAgentMessage(record);
        });
    }

    saveMessages(key: ChatKey, messages: AgentMessage[]): void {
        const db = sqliteManager.getDatabase();

        sqliteManager.transaction(() => {
            db.prepare(
                'DELETE FROM chat_messages WHERE channel = ? AND type = ? AND chat_id = ?',
            ).run(key.channel, key.type, key.chatId);

            if (messages.length === 0) {
                return;
            }

            const stmt = db.prepare(`
        INSERT INTO chat_messages (channel, type, chat_id, sequence, role, content, tool_calls, tool_call_id, name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

            for (const [index, message] of messages.entries()) {
                const record = serializeAgentMessage(message);
                stmt.run(
                    key.channel,
                    key.type,
                    key.chatId,
                    index,
                    record.role,
                    record.content,
                    record.toolCalls ? JSON.stringify(record.toolCalls) : null,
                    record.toolCallId || null,
                    record.name || null,
                );
            }
        });

        logger.debug(
            {
                channel: key.channel,
                type: key.type,
                chatId: key.chatId,
                count: messages.length,
            },
            'Chat messages saved',
        );
    }
}

export const chatStore = new ChatStore();
