import fs from 'node:fs/promises';
import path from 'node:path';
import type { PersistableMessage } from '@aesyclaw/core/types';
import { createScopedLogger } from '@aesyclaw/core/logger';

const logger = createScopedLogger('session-file-store');

type SessionFile = {
  sessionId: string;
  version: number;
  messages: PersistableMessage[];
};

export class SessionFileStore {
  constructor(private sessionsDir: string) {}

  private filePath(sessionId: string): string {
    return path.join(this.sessionsDir, `${sessionId}.json`);
  }

  async load(sessionId: string): Promise<PersistableMessage[]> {
    try {
      const data = await fs.readFile(this.filePath(sessionId), 'utf-8');
      const file: SessionFile = JSON.parse(data);
      return file.messages;
    } catch {
      return [];
    }
  }

  async save(sessionId: string, message: PersistableMessage): Promise<void> {
    await fs.mkdir(this.sessionsDir, { recursive: true });
    const existing = await this.load(sessionId);
    existing.push(message);
    await fs.writeFile(
      this.filePath(sessionId),
      JSON.stringify({ sessionId, version: 1, messages: existing }, null, 2),
      'utf-8',
    );
  }

  async clear(sessionId: string): Promise<void> {
    try {
      await fs.unlink(this.filePath(sessionId));
    } catch {}
  }

  async replaceWithSummary(sessionId: string, summary: string): Promise<void> {
    const message: PersistableMessage = {
      role: 'assistant',
      content: summary,
      timestamp: new Date().toISOString(),
    };
    await fs.writeFile(
      this.filePath(sessionId),
      JSON.stringify({ sessionId, version: 1, messages: [message] }, null, 2),
      'utf-8',
    );
  }

  /** 删除会话的 JSON 文件 */
  async delete(sessionId: string): Promise<void> {
    try {
      await fs.unlink(this.filePath(sessionId));
    } catch {}
  }

  /** 读取所有 JSON 文件返回摘要信息 */
  async findAllSummaries(): Promise<
    Array<{
      id: string;
      channel?: string;
      type?: string;
      chatId?: string;
      messageCount: number;
      firstUserMessage?: string;
      lastActivity?: string;
    }>
  > {
    try {
      await fs.mkdir(this.sessionsDir, { recursive: true });
      const files = await fs.readdir(this.sessionsDir);
      const summaries: Array<{
        id: string;
        channel?: string;
        type?: string;
        chatId?: string;
        messageCount: number;
        firstUserMessage?: string;
        lastActivity?: string;
      }> = [];
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const data = await fs.readFile(path.join(this.sessionsDir, file), 'utf-8');
          const sf: SessionFile = JSON.parse(data);
          const msgs = sf.messages;
          const firstUser = msgs.find((m) => m.role === 'user');
          const last = msgs[msgs.length - 1];
          summaries.push({
            id: sf.sessionId,
            channel: undefined,
            type: undefined,
            chatId: undefined,
            messageCount: msgs.length,
            firstUserMessage: firstUser?.content,
            lastActivity: last?.timestamp,
          });
        } catch {}
      }
      return summaries.sort((a, b) => (b.lastActivity ?? '').localeCompare(a.lastActivity ?? ''));
    } catch {
      return [];
    }
  }

  /** 获取最后一条消息的时间戳 */
  async getLastActivity(sessionId: string): Promise<string | undefined> {
    const msgs = await this.load(sessionId);
    return msgs[msgs.length - 1]?.timestamp;
  }

  /** 获取消息数量 */
  async getMessageCount(sessionId: string): Promise<number> {
    const msgs = await this.load(sessionId);
    return msgs.length;
  }
}
