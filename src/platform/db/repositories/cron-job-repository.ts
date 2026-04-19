import { logger } from '@/platform/observability/logger.js';
import { sqliteManager } from '../sqlite-manager.js';
export interface CronJob {
  id: string;
  name: string;
  cronExpression: string;
  prompt: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  nextRunAt?: string;
}

type CronJobRow = {
  id: string;
  name: string;
  cron_expression: string;
  prompt: string;
  enabled: number;
  created_at: string;
  updated_at: string;
  last_run_at?: string;
  next_run_at?: string;
};

export interface CreateCronJobRecordInput {
  id: string;
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

class CronJobRepository {
  private get db() {
    return sqliteManager.getDatabase();
  }

  private mapRow(row: CronJobRow): CronJob {
    return {
      id: row.id,
      name: row.name,
      cronExpression: row.cron_expression,
      prompt: row.prompt,
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastRunAt: row.last_run_at,
      nextRunAt: row.next_run_at,
    };
  }

  create(input: CreateCronJobRecordInput): CronJob {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO cron_jobs (id, name, cron_expression, prompt, next_run_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(input.id, input.name, input.cronExpression, input.prompt, input.nextRunAt || null, now, now);
    logger.info({ id: input.id }, 'Cron job created');
    return this.findById(input.id)!;
  }

  findById(id: string): CronJob | null {
    const row = this.db.prepare('SELECT * FROM cron_jobs WHERE id = ?').get(id) as CronJobRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  findAll(): CronJob[] {
    const rows = this.db.prepare('SELECT * FROM cron_jobs ORDER BY created_at DESC').all() as CronJobRow[];
    return rows.map(row => this.mapRow(row));
  }

  findEnabled(): CronJob[] {
    const rows = this.db.prepare('SELECT * FROM cron_jobs WHERE enabled = 1 ORDER BY next_run_at ASC').all() as CronJobRow[];
    return rows.map(row => this.mapRow(row));
  }

  findDue(beforeIso: string): CronJob[] {
    const rows = this.db.prepare(
      'SELECT * FROM cron_jobs WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at ASC'
    ).all(beforeIso) as CronJobRow[];
    return rows.map(row => this.mapRow(row));
  }

  findNextScheduled(): CronJob | null {
    const row = this.db.prepare(
      'SELECT * FROM cron_jobs WHERE enabled = 1 AND next_run_at IS NOT NULL ORDER BY next_run_at ASC LIMIT 1'
    ).get() as CronJobRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  update(id: string, updates: UpdateCronJobRecordInput): CronJob | null {
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

  updateSchedule(id: string, updates: { lastRunAt?: string; nextRunAt?: string | null }): void {
    const fields: string[] = ['updated_at = ?'];
    const values: Array<string | number | null> = [new Date().toISOString()];

    if (updates.lastRunAt !== undefined) {
      fields.push('last_run_at = ?');
      values.push(updates.lastRunAt);
    }
    if (updates.nextRunAt !== undefined) {
      fields.push('next_run_at = ?');
      values.push(updates.nextRunAt);
    }

    values.push(id);
    this.db.prepare(`UPDATE cron_jobs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }
}

export const cronJobRepository = new CronJobRepository();
