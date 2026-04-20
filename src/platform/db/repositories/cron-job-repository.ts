import { logger } from '@/platform/observability/logger.js';
import { parseSchedule, serializeSchedule } from '@/platform/cron/schedule-engine.js';
import type { CronSchedule } from '@/platform/cron/schedule-engine.js';
import { sqliteManager } from '../sqlite-manager.js';
export interface CronJob {
    id: string;
    name: string;
    prompt: string;
    schedule: CronSchedule;
    createdAt: string;
    updatedAt: string;
    lastRunAt?: string;
    nextRunAt?: string;
}

type CronJobRow = {
    id: string;
    name: string;
    prompt: string;
    schedule_type?: string;
    schedule_data?: string;
    created_at: string;
    updated_at: string;
    last_run_at?: string;
    next_run_at?: string;
};

export interface CreateCronJobRecordInput {
    id: string;
    name: string;
    prompt: string;
    schedule: CronSchedule;
    nextRunAt?: string;
}

export interface UpdateCronJobRecordInput {
    name?: string;
    prompt?: string;
    lastRunAt?: string;
    nextRunAt?: string | null;
}

class CronJobRepository {
    private get db() {
        return sqliteManager.getDatabase();
    }

    private buildUpdateStatement(entries: Array<[string, string | number | null | undefined]>): {
        fields: string[];
        values: Array<string | number | null>;
        hasChanges: boolean;
    } {
        const fields: string[] = ['updated_at = ?'];
        const values: Array<string | number | null> = [new Date().toISOString()];
        let hasChanges = false;

        for (const [field, value] of entries) {
            if (value === undefined) {
                continue;
            }

            fields.push(`${field} = ?`);
            values.push(value);
            hasChanges = true;
        }

        return { fields, values, hasChanges };
    }

    private mapRow(row: CronJobRow): CronJob | null {
        const schedule = parseSchedule(row.schedule_type, row.schedule_data);
        if (!schedule) {
            logger.warn(
                { jobId: row.id, scheduleType: row.schedule_type },
                'Skipping cron job row with invalid schedule metadata',
            );
            return null;
        }

        return {
            id: row.id,
            name: row.name,
            prompt: row.prompt,
            schedule,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            lastRunAt: row.last_run_at,
            nextRunAt: row.next_run_at,
        };
    }

    private mapRows(rows: CronJobRow[]): CronJob[] {
        return rows.flatMap((row) => {
            const job = this.mapRow(row);
            return job ? [job] : [];
        });
    }

    create(input: CreateCronJobRecordInput): CronJob {
        const now = new Date().toISOString();
        const persistedSchedule = serializeSchedule(input.schedule);
        this.db
            .prepare(
                `
      INSERT INTO cron_jobs (
        id,
        name,
        prompt,
        schedule_type,
        schedule_data,
        next_run_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
            )
            .run(
                input.id,
                input.name,
                input.prompt,
                persistedSchedule.scheduleType,
                persistedSchedule.scheduleData,
                input.nextRunAt || null,
                now,
                now,
            );
        logger.info({ id: input.id }, 'Cron job created');
        return this.findById(input.id)!;
    }

    findById(id: string): CronJob | null {
        const row = this.db.prepare('SELECT * FROM cron_jobs WHERE id = ?').get(id) as
            | CronJobRow
            | undefined;
        return row ? this.mapRow(row) : null;
    }

    findAll(): CronJob[] {
        const rows = this.db
            .prepare('SELECT * FROM cron_jobs ORDER BY created_at DESC')
            .all() as CronJobRow[];
        return this.mapRows(rows);
    }

    findScheduled(): CronJob[] {
        const rows = this.db
            .prepare(
                `SELECT * FROM cron_jobs
       WHERE schedule_type IS NOT NULL AND next_run_at IS NOT NULL
       ORDER BY next_run_at ASC`,
            )
            .all() as CronJobRow[];
        return this.mapRows(rows);
    }

    findDue(beforeIso: string): CronJob[] {
        const rows = this.db
            .prepare(
                `SELECT * FROM cron_jobs
       WHERE schedule_type IS NOT NULL AND next_run_at IS NOT NULL AND next_run_at <= ?
       ORDER BY next_run_at ASC`,
            )
            .all(beforeIso) as CronJobRow[];
        return this.mapRows(rows);
    }

    update(id: string, updates: UpdateCronJobRecordInput): CronJob | null {
        const { fields, values, hasChanges } = this.buildUpdateStatement([
            ['name', updates.name],
            ['prompt', updates.prompt],
            ['last_run_at', updates.lastRunAt],
            ['next_run_at', updates.nextRunAt],
        ]);

        if (!hasChanges) {
            return this.findById(id);
        }

        values.push(id);
        const result = this.db
            .prepare(`UPDATE cron_jobs SET ${fields.join(', ')} WHERE id = ?`)
            .run(...values);
        if (result.changes === 0) {
            return null;
        }

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
        const { fields, values } = this.buildUpdateStatement([
            ['last_run_at', updates.lastRunAt],
            ['next_run_at', updates.nextRunAt],
        ]);

        values.push(id);
        this.db.prepare(`UPDATE cron_jobs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }
}

export const cronJobRepository = new CronJobRepository();
