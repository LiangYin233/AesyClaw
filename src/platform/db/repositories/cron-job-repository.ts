import { logger } from '@/platform/observability/logger.js';
import { BaseRepository } from './base-repository.js';

export interface CronJobRecord {
  id: string;
  chatId: string;
  name: string;
  cronExpression: string;
  prompt: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  nextRunAt?: string;
}

export interface CreateCronJobRecordInput {
  id: string;
  chatId: string;
  name: string;
  cronExpression: string;
  prompt: string;
  nextRunAt?: string;
}

export interface UpdateCronJobRecordInput {
  name?: string;
  cronExpression?: string;
  prompt?: string;
  enabled?: boolean;
  lastRunAt?: string;
  nextRunAt?: string | null;
}

export type CronJobRow = {
  id: string;
  chat_id: string;
  name: string;
  cron_expression: string;
  prompt: string;
  enabled: number;
  created_at: string;
  updated_at: string;
  last_run_at?: string;
  next_run_at?: string;
};

export class CronJobRepository extends BaseRepository<CronJobRow, CronJobRecord> {
  create(input: CreateCronJobRecordInput): CronJobRecord {
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO cron_jobs (id, chat_id, name, cron_expression, prompt, next_run_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.id, input.chatId, input.name, input.cronExpression,
      input.prompt, input.nextRunAt || null, now, now
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

  findNextScheduled(): CronJobRecord | null {
    return this.queryOne(
      'SELECT * FROM cron_jobs WHERE enabled = 1 AND next_run_at IS NOT NULL ORDER BY next_run_at ASC LIMIT 1'
    );
  }

  update(id: string, updates: UpdateCronJobRecordInput): CronJobRecord | null {
    const fields: string[] = ['updated_at = ?'];
    const values: Array<string | number | null> = [];
    values.push(new Date().toISOString());

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.cronExpression !== undefined) {
      fields.push('cron_expression = ?');
      values.push(updates.cronExpression);
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

    if (fields.length === 1) return this.findById(id);

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

  markRunStarted(id: string, startedAt: string): void {
    this.db.prepare(`
      UPDATE cron_jobs
      SET last_run_at = ?, updated_at = ?
      WHERE id = ?
    `).run(startedAt, startedAt, id);
  }

  updateSchedule(id: string, updates: { enabled?: boolean; nextRunAt?: string | null; lastRunAt?: string }): void {
    const fields: string[] = ['updated_at = ?'];
    const values: Array<string | number | null> = [new Date().toISOString()];

    if (updates.enabled !== undefined) {
      fields.push('enabled = ?');
      values.push(updates.enabled ? 1 : 0);
    }
    if (updates.nextRunAt !== undefined) {
      fields.push('next_run_at = ?');
      values.push(updates.nextRunAt);
    }
    if (updates.lastRunAt !== undefined) {
      fields.push('last_run_at = ?');
      values.push(updates.lastRunAt);
    }

    values.push(id);
    this.db.prepare(`UPDATE cron_jobs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  protected mapRow(row: CronJobRow): CronJobRecord {
    return {
      id: row.id,
      chatId: row.chat_id,
      name: row.name,
      cronExpression: row.cron_expression,
      prompt: row.prompt || '',
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastRunAt: row.last_run_at,
      nextRunAt: row.next_run_at,
    };
  }
}

export const cronJobRepository = new CronJobRepository();
