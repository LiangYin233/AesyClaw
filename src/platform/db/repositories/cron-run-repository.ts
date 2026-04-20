import { randomUUID } from 'crypto';
import { logger } from '@/platform/observability/logger.js';
import { sqliteManager } from '../sqlite-manager.js';
export type CronRunStatus = 'running' | 'succeeded' | 'failed' | 'abandoned';

export interface CronRun {
    id: string;
    jobId: string;
    status: CronRunStatus;
    startedAt: string;
    finishedAt?: string;
    error?: string;
}

type CronRunRow = {
    id: string;
    job_id: string;
    status: string;
    started_at: string;
    finished_at?: string;
    error?: string;
};

class CronRunRepository {
    private get db() {
        return sqliteManager.getDatabase();
    }

    private mapRow(row: CronRunRow): CronRun {
        return {
            id: row.id,
            jobId: row.job_id,
            status: row.status as CronRunStatus,
            startedAt: row.started_at,
            finishedAt: row.finished_at,
            error: row.error,
        };
    }

    createRunning(jobId: string, startedAt: string): CronRun {
        const id = randomUUID();
        this.db
            .prepare(
                `
      INSERT INTO cron_runs (id, job_id, status, started_at)
      VALUES (?, ?, ?, ?)
    `,
            )
            .run(id, jobId, 'running', startedAt);
        logger.info({ runId: id, jobId }, 'Cron run created');
        return this.findById(id)!;
    }

    finish(
        runId: string,
        status: Exclude<CronRunStatus, 'running'>,
        finishedAt: string,
        error?: string,
    ): CronRun | null {
        const result = this.db
            .prepare(
                `
      UPDATE cron_runs SET status = ?, finished_at = ?, error = ? WHERE id = ?
    `,
            )
            .run(status, finishedAt, error || null, runId);

        if (result.changes === 0) {
            return null;
        }

        logger.info({ runId, status }, 'Cron run finished');
        return this.findById(runId);
    }

    markAllRunningAsAbandoned(finishedAt: string): number {
        const result = this.db
            .prepare(
                `
      UPDATE cron_runs SET status = 'abandoned', finished_at = ? WHERE status = 'running'
    `,
            )
            .run(finishedAt);
        const count = result.changes || 0;
        if (count > 0) {
            logger.info({ count }, 'Marked stale cron runs as abandoned');
        }
        return count;
    }

    findById(id: string): CronRun | null {
        const row = this.db.prepare('SELECT * FROM cron_runs WHERE id = ?').get(id) as
            | CronRunRow
            | undefined;
        return row ? this.mapRow(row) : null;
    }

    findLatestByJobId(jobId: string, limit: number = 20): CronRun[] {
        const rows = this.db
            .prepare('SELECT * FROM cron_runs WHERE job_id = ? ORDER BY started_at DESC LIMIT ?')
            .all(jobId, limit) as CronRunRow[];
        return rows.map((row) => this.mapRow(row));
    }
}

export const cronRunRepository = new CronRunRepository();
