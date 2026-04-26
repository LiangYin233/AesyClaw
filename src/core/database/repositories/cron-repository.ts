/**
 * CronRepository — data access for the cron_jobs and cron_runs tables.
 *
 * Contains functions for both cron job and cron run database operations.
 * All functions return Promises for consistent async patterns.
 */

import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { CronJobRecord, CronRunRecord, SessionKey } from '../../types';

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

// ─── Cron Jobs ────────────────────────────────────────────────────

/** Create a new cron job and return its generated ID */
export async function createCronJob(
  db: DatabaseSync,
  params: {
    scheduleType: string;
    scheduleValue: string;
    prompt: string;
    sessionKey: SessionKey;
    nextRun: Date | null;
  },
): Promise<string> {
  const id = randomUUID();
  const sessionKeyJson = JSON.stringify(params.sessionKey);
  const nextRunStr = params.nextRun?.toISOString() ?? null;
  const now = new Date().toISOString();

  db.prepare(
    'INSERT INTO cron_jobs (id, schedule_type, schedule_value, prompt, session_key, next_run, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, params.scheduleType, params.scheduleValue, params.prompt, sessionKeyJson, nextRunStr, now);

  return id;
}

/** Find a cron job by ID. Returns null if not found. */
export async function findCronJobById(
  db: DatabaseSync,
  id: string,
): Promise<CronJobRecord | null> {
  const row = db.prepare('SELECT * FROM cron_jobs WHERE id = ?').get(id) as CronJobRow | undefined;
  return row ? mapJobRow(row) : null;
}

/** Get all cron jobs */
export async function findAllCronJobs(db: DatabaseSync): Promise<CronJobRecord[]> {
  const rows = db
    .prepare('SELECT * FROM cron_jobs ORDER BY next_run ASC')
    .all() as unknown as CronJobRow[];
  return rows.map(mapJobRow);
}

/** Delete a cron job by ID. Returns true if a row was deleted. */
export async function deleteCronJob(db: DatabaseSync, id: string): Promise<boolean> {
  const result = db.prepare('DELETE FROM cron_jobs WHERE id = ?').run(id);
  return result.changes > 0;
}

/** Update the next_run time for a cron job */
export async function updateCronJobNextRun(
  db: DatabaseSync,
  id: string,
  nextRun: Date | null,
): Promise<void> {
  const nextRunStr = nextRun?.toISOString() ?? null;
  db.prepare('UPDATE cron_jobs SET next_run = ? WHERE id = ?').run(nextRunStr, id);
}

// ─── Cron Runs ────────────────────────────────────────────────────

/** Create a new cron run record. Returns the generated run ID. */
export async function createCronRun(
  db: DatabaseSync,
  params: { jobId: string },
): Promise<string> {
  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare('INSERT INTO cron_runs (id, job_id, status, started_at) VALUES (?, ?, ?, ?)')
    .run(id, params.jobId, 'running', now);

  return id;
}

/** Mark a run as completed */
export async function markCronRunCompleted(
  db: DatabaseSync,
  runId: string,
  result: string,
): Promise<void> {
  const now = new Date().toISOString();
  db.prepare('UPDATE cron_runs SET status = ?, result = ?, ended_at = ? WHERE id = ?')
    .run('completed', result, now, runId);
}

/** Mark a run as failed */
export async function markCronRunFailed(
  db: DatabaseSync,
  runId: string,
  error: string,
): Promise<void> {
  const now = new Date().toISOString();
  db.prepare('UPDATE cron_runs SET status = ?, error = ?, ended_at = ? WHERE id = ?')
    .run('failed', error, now, runId);
}

/** Mark multiple runs as abandoned (e.g. on startup for leftover 'running' runs) */
export async function markCronRunsAbandoned(
  db: DatabaseSync,
  runIds: string[],
): Promise<void> {
  if (runIds.length === 0) return;

  const now = new Date().toISOString();
  const stmt = db.prepare('UPDATE cron_runs SET status = ?, ended_at = ? WHERE id = ?');

  db.exec('BEGIN');

  try {
    for (const id of runIds) {
      stmt.run('abandoned', now, id);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** Find all currently running runs */
export async function findRunningCronRuns(db: DatabaseSync): Promise<CronRunRecord[]> {
  const rows = db
    .prepare("SELECT * FROM cron_runs WHERE status = 'running'")
    .all() as unknown as CronRunRow[];
  return rows.map(mapRunRow);
}
