/**
 * CronRepository — data access for the cron_jobs and cron_runs tables.
 *
 * Contains both CronJobRepository and CronRunRepository.
 * All methods return Promises for consistent async patterns.
 */

import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { CronJobRecord, CronRunRecord, SessionKey } from '../../types';

// ─── CronJobRepository ────────────────────────────────────────────

export class CronJobRepository {
  constructor(private db: DatabaseSync) {}

  /** Create a new cron job and return its generated ID */
  async create(params: {
    scheduleType: string;
    scheduleValue: string;
    prompt: string;
    sessionKey: SessionKey;
    nextRun: Date | null;
  }): Promise<string> {
    const id = randomUUID();
    const sessionKeyJson = JSON.stringify(params.sessionKey);
    const nextRunStr = params.nextRun?.toISOString() ?? null;
    const now = new Date().toISOString();

    this.db
      .prepare(
        'INSERT INTO cron_jobs (id, schedule_type, schedule_value, prompt, session_key, next_run, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        params.scheduleType,
        params.scheduleValue,
        params.prompt,
        sessionKeyJson,
        nextRunStr,
        now,
      );

    return id;
  }

  /** Find a cron job by ID. Returns null if not found. */
  async findById(id: string): Promise<CronJobRecord | null> {
    const row = this.db.prepare('SELECT * FROM cron_jobs WHERE id = ?').get(id) as
      | CronJobRow
      | undefined;

    return row ? mapJobRow(row) : null;
  }

  /** Get all cron jobs */
  async findAll(): Promise<CronJobRecord[]> {
    const rows = this.db
      .prepare('SELECT * FROM cron_jobs ORDER BY next_run ASC')
      .all() as unknown as CronJobRow[];

    return rows.map(mapJobRow);
  }

  /** Delete a cron job by ID. Returns true if a row was deleted. */
  async delete(id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM cron_jobs WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /** Update the next_run time for a cron job */
  async updateNextRun(id: string, nextRun: Date | null): Promise<void> {
    const nextRunStr = nextRun?.toISOString() ?? null;
    this.db.prepare('UPDATE cron_jobs SET next_run = ? WHERE id = ?').run(nextRunStr, id);
  }
}

// ─── CronRunRepository ───────────────────────────────────────────

export class CronRunRepository {
  constructor(private db: DatabaseSync) {}

  /** Create a new cron run record. Returns the generated run ID. */
  async create(params: { jobId: string }): Promise<string> {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.db
      .prepare('INSERT INTO cron_runs (id, job_id, status, started_at) VALUES (?, ?, ?, ?)')
      .run(id, params.jobId, 'running', now);

    return id;
  }

  /** Mark a run as completed */
  async markCompleted(runId: string, result: string): Promise<void> {
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE cron_runs SET status = ?, result = ?, ended_at = ? WHERE id = ?')
      .run('completed', result, now, runId);
  }

  /** Mark a run as failed */
  async markFailed(runId: string, error: string): Promise<void> {
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE cron_runs SET status = ?, error = ?, ended_at = ? WHERE id = ?')
      .run('failed', error, now, runId);
  }

  /** Mark multiple runs as abandoned (e.g. on startup for leftover 'running' runs) */
  async markAbandoned(runIds: string[]): Promise<void> {
    if (runIds.length === 0) return;

    const now = new Date().toISOString();
    const stmt = this.db.prepare('UPDATE cron_runs SET status = ?, ended_at = ? WHERE id = ?');

    this.db.exec('BEGIN');

    try {
      for (const id of runIds) {
        stmt.run('abandoned', now, id);
      }

      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /** Find all currently running runs */
  async findRunning(): Promise<CronRunRecord[]> {
    const rows = this.db
      .prepare("SELECT * FROM cron_runs WHERE status = 'running'")
      .all() as unknown as CronRunRow[];

    return rows.map(mapRunRow);
  }
}

// ─── Row type helpers ─────────────────────────────────────────────

interface CronJobRow {
  id: string;
  schedule_type: string;
  schedule_value: string;
  prompt: string;
  session_key: string;
  next_run: string | null;
  created_at: string;
}

interface CronRunRow {
  id: string;
  job_id: string;
  status: string;
  result: string | null;
  error: string | null;
  started_at: string;
  ended_at: string | null;
}

function mapJobRow(row: CronJobRow): CronJobRecord {
  return {
    id: row.id,
    scheduleType: row.schedule_type,
    scheduleValue: row.schedule_value,
    prompt: row.prompt,
    sessionKey: row.session_key,
    nextRun: row.next_run,
    createdAt: row.created_at,
  };
}

function mapRunRow(row: CronRunRow): CronRunRecord {
  return {
    id: row.id,
    jobId: row.job_id,
    status: row.status,
    result: row.result,
    error: row.error,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}
