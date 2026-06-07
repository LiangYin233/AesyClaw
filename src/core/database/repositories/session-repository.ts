/**
 * SessionRepository — sessions 表的数据访问层。
 *
 * 所有方法均返回 Promise（包装同步 SQLite 调用）
 * 以便未来灵活扩展和保持一致的异步模式。
 */

import { randomUUID } from 'node:crypto';
import type { SessionKey, SessionRecord } from '@aesyclaw/core/types';
import { BaseRepository } from './base-repository';

// ─── 行类型 ─────────────────────────────────────────────────────

type SessionRow = {
  id: string;
  channel: string;
  type: string;
  chat_id: string;
  role_id: string | null;
  model_id: string | null;
};

// ─── 仓储类 ─────────────────────────────────────────────────────

export class SessionRepository extends BaseRepository<SessionRecord, SessionRow> {
  protected getTableName(): string {
    return 'sessions';
  }

  protected getPrimaryKey(): string {
    return 'id';
  }

  protected mapRow(row: SessionRow): SessionRecord {
    return {
      id: row['id'],
      channel: row['channel'],
      type: row['type'],
      chatId: row['chat_id'],
      role_id: row['role_id'] ?? undefined,
      model_id: row['model_id'] ?? undefined,
    };
  }

  protected mapToFields(entity: Partial<SessionRecord>): Record<string, unknown> {
    const fields: Record<string, unknown> = {};
    if (entity['id'] !== undefined) fields['id'] = entity['id'];
    if (entity['channel'] !== undefined) fields['channel'] = entity['channel'];
    if (entity['type'] !== undefined) fields['type'] = entity['type'];
    if (entity['chatId'] !== undefined) fields['chat_id'] = entity['chatId'];
    if (entity['role_id'] !== undefined) fields['role_id'] = entity['role_id'];
    if (entity['model_id'] !== undefined) fields['model_id'] = entity['model_id'];
    return fields;
  }

  /** 按复合键查找会话。未找到时返回 null。 */
  async findByKey(key: SessionKey): Promise<SessionRecord | null> {
    const row = this.queryOne<SessionRow>(
      'SELECT id, channel, type, chat_id, role_id, model_id FROM sessions WHERE channel = ? AND type = ? AND chat_id = ?',
      key.channel,
      key.type,
      key.chatId,
    );

    return row ? this.mapRow(row) : null;
  }

  /** 按复合键查找现有会话，如不存在则创建。 */
  async findOrCreate(key: SessionKey): Promise<SessionRecord> {
    const id = randomUUID();

    this.exec(
      'INSERT OR IGNORE INTO sessions (id, channel, type, chat_id) VALUES (?, ?, ?, ?)',
      id,
      key.channel,
      key.type,
      key.chatId,
    );

    const session = await this.findByKey(key);
    if (!session) {
      throw new Error('查找或创建会话失败');
    }

    return session;
  }

  /** 按 ID 删除会话及其直接关联数据。返回是否删除了会话。 */
  async deleteWithRelations(id: string): Promise<boolean> {
    const row = this.queryOne<{ id: string }>('SELECT id FROM sessions WHERE id = ?', id);

    if (!row) return false;

    return await this.transactionAsync(async () => {
      this.exec('UPDATE usage SET session_id = NULL WHERE session_id = ?', id);
      this.exec('DELETE FROM sessions WHERE id = ?', id);
      return true;
    });
  }

  /** 设置会话的角色 */
  async setRole(id: string, roleId: string): Promise<void> {
    this.exec('UPDATE sessions SET role_id = ? WHERE id = ?', roleId, id);
  }

  /** 设置会话的模型 */
  async setModel(id: string, modelId: string): Promise<void> {
    this.exec('UPDATE sessions SET model_id = ? WHERE id = ?', modelId, id);
  }
}

// ─── 公共 API ───────────────────────────────────────────────────

/** 可导出的仓储类，供 DatabaseManager 直接使用。 */
// SessionRepository 已在类定义处导出，无需额外导出。
