import { logger } from '@/platform/observability/logger.js';
import { BaseRepository } from './base-repository.js';

export interface CronJobRecord {
  id: string;
  chatId: string;
  name: string;
  cronExpression: string;
  command: string;
  prompt: string;
  enabled: boolean;
  createdAt: string;
  lastRunAt?: string;
  nextRunAt?: string;
  runCount: number;
  metadata: Record<string, unknown>;
}

export interface CreateCronJobRecordInput {
  id: string;
  chatId: string;
  name: string;
  cronExpression: string;
  command: string;
  prompt: string;
  nextRunAt?: string;
  metadata?: Record<string, unknown>;
}

export type CronJobRow = {
  id: string;
  chat_id: string;
  name: string;
  cron_expression: string;
  command: string;
  prompt: string;
  enabled: number;
  created_at: string;
  last_run_at?: string;
  next_run_at?: string;
  run_count: number;
  metadata: string;
};

export class CronJobRepository extends BaseRepository<CronJobRow, CronJobRecord> {
  create(input: CreateCronJobRecordInput): CronJobRecord {
    const metadata = JSON.stringify(input.metadata || {});

    this.db.prepare(`
      INSERT INTO cron_jobs (id, chat_id, name, cron_expression, command, prompt, next_run_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.id, input.chatId, input.name, input.cronExpression,
      input.command, input.prompt, input.nextRunAt || null, metadata
    );

    logger.info({ id: input.id, chatId: input.chatId }, 'Cron job created');
    return this.findById(input.id)!;
  }

  findById(id: string): CronJobRecord | null {
    return this.queryOne('SELECT * FROM cron_jobs WHERE id = ?', id);
  }

  findByChatId(chatId: string): CronJobRecord[] {
    return this.queryMany('SELECT * FROM cron_jobs WHERE chat_id = ? ORDER BY created_at DESC', chatId);
  }

  findEnabled(): CronJobRecord[] {
    return this.queryMany('SELECT * FROM cron_jobs WHERE enabled = 1 ORDER BY next_run_at ASC');
  }

  findDueJobs(): CronJobRecord[] {
    const now = new Date().toISOString();
    return this.queryMany(
      'SELECT * FROM cron_jobs WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at ASC',
      now
    );
  }

  update(id: string, updates: Partial<Omit<CronJobRecord, 'id' | 'createdAt'>>): CronJobRecord | null {
    const fields: string[] = [];
    const values: Array<string | number | null> = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.cronExpression !== undefined) {
      fields.push('cron_expression = ?');
      values.push(updates.cronExpression);
    }
    if (updates.command !== undefined) {
      fields.push('command = ?');
      values.push(updates.command);
    }
    if (updates.prompt !== undefined) {
      fields.push('prompt = ?');
      values.push(updates.prompt);
    }
    if (updates.enabled !== undefined) {
      fields.push('enabled = ?');
      values.push(updates.enabled ? 1 : 0);
    }
    if (updates.lastRunAt !== undefined) {
      fields.push('last_run_at = ?');
      values.push(updates.lastRunAt);
    }
    if (updates.nextRunAt !== undefined) {
      fields.push('next_run_at = ?');
      values.push(updates.nextRunAt);
    }
    if (updates.metadata !== undefined) {
      fields.push('metadata = ?');
      values.push(JSON.stringify(updates.metadata));
    }

    if (fields.length === 0) return this.findById(id);

    values.push(id);
    const result = this.db.prepare(`UPDATE cron_jobs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    if (result.changes === 0) return null;

    logger.info({ id }, 'Cron job updated');
    return this.findById(id);
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM cron_jobs WHERE id = ?').run(id);

    if (result.changes > 0) {
      logger.info({ id }, 'Cron job deleted');
      return true;
    }
    return false;
  }

  deleteByChatId(chatId: string): number {
    const result = this.db.prepare('DELETE FROM cron_jobs WHERE chat_id = ?').run(chatId);

    if (result.changes > 0) {
      logger.info({ chatId, count: result.changes }, 'Cron jobs deleted for chat');
    }
    return result.changes;
  }

  incrementRunCount(id: string): void {
    this.db.prepare(`
      UPDATE cron_jobs
      SET run_count = run_count + 1, last_run_at = datetime('now')
      WHERE id = ?
    `).run(id);
  }

  incrementErrorCount(id: string): void {
    this.db.prepare(`
      UPDATE cron_jobs
      SET last_run_at = datetime('now'),
          metadata = JSON_SET(COALESCE(metadata, '{}'), '$.lastError', datetime('now'))
      WHERE id = ?
    `).run(id);
  }

  setNextRunTime(id: string, nextRunAt: string): void {
    this.db.prepare('UPDATE cron_jobs SET next_run_at = ? WHERE id = ?').run(nextRunAt, id);
  }

  protected mapRow(row: CronJobRow): CronJobRecord {
    return {
      id: row.id,
      chatId: row.chat_id,
      name: row.name,
      cronExpression: row.cron_expression,
      command: row.command,
      prompt: row.prompt || '',
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      lastRunAt: row.last_run_at,
      nextRunAt: row.next_run_at,
      runCount: row.run_count,
      metadata: JSON.parse(row.metadata || '{}'),
    };
  }
}

export const cronJobRepository = new CronJobRepository();
