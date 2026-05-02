/**
 * CronRepository — cron_jobs 和 cron_runs 表的数据访问层。
 *
 * 包含定时任务和定时任务执行的数据库操作函数。
 * 所有函数均返回 Promise 以保持一致异步模式。
 */

import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { CronJobRecord, CronRunRecord, SessionKey } from '../../types';
import { serializeSessionKey } from '../../types';

// ─── 行类型辅助函数 ─────────────────────────────────────────────

type CronJobRow = {
  id: string;
  schedule_type: string;
  schedule_value: string;
  prompt: string;
  session_key: string;
  next_run: string | null;
  created_at: string;
}

type CronRunRow = {
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

// ─── 定时任务 ────────────────────────────────────────────────────

/** 创建一个新的定时任务并返回其生成的 ID */
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
  const sessionKeyJson = serializeSessionKey(params.sessionKey);
  const nextRunStr = params.nextRun?.toISOString() ?? null;
  const now = new Date().toISOString();

  db.prepare(
    'INSERT INTO cron_jobs (id, schedule_type, schedule_value, prompt, session_key, next_run, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(
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

/** 按 ID 查找定时任务。未找到时返回 null。 */
export async function findCronJobById(db: DatabaseSync, id: string): Promise<CronJobRecord | null> {
  const row = db.prepare('SELECT * FROM cron_jobs WHERE id = ?').get(id) as CronJobRow | undefined;
  return row ? mapJobRow(row) : null;
}

/** 获取所有定时任务 */
export async function findAllCronJobs(db: DatabaseSync): Promise<CronJobRecord[]> {
  const rows = db
    .prepare('SELECT * FROM cron_jobs ORDER BY next_run ASC')
    .all() as unknown as CronJobRow[];
  return rows.map(mapJobRow);
}

/** 按 ID 删除定时任务。有行被删除时返回 true。 */
export async function deleteCronJob(db: DatabaseSync, id: string): Promise<boolean> {
  db.exec('BEGIN');

  try {
    db.prepare('DELETE FROM cron_runs WHERE job_id = ?').run(id);
    const result = db.prepare('DELETE FROM cron_jobs WHERE id = ?').run(id);
    db.exec('COMMIT');
    return result.changes > 0;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** 更新定时任务的 next_run 时间 */
export async function updateCronJobNextRun(
  db: DatabaseSync,
  id: string,
  nextRun: Date | null,
): Promise<void> {
  const nextRunStr = nextRun?.toISOString() ?? null;
  db.prepare('UPDATE cron_jobs SET next_run = ? WHERE id = ?').run(nextRunStr, id);
}

// ─── 定时任务执行 ────────────────────────────────────────────────────

/** 创建一个新的定时任务执行记录。返回生成的执行 ID。 */
export async function createCronRun(db: DatabaseSync, params: { jobId: string }): Promise<string> {
  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare('INSERT INTO cron_runs (id, job_id, status, started_at) VALUES (?, ?, ?, ?)').run(
    id,
    params.jobId,
    'running',
    now,
  );

  return id;
}

/** 将执行标记为已完成 */
export async function markCronRunCompleted(
  db: DatabaseSync,
  runId: string,
  result: string,
): Promise<void> {
  const now = new Date().toISOString();
  db.prepare('UPDATE cron_runs SET status = ?, result = ?, ended_at = ? WHERE id = ?').run(
    'completed',
    result,
    now,
    runId,
  );
}

/** 将执行标记为失败 */
export async function markCronRunFailed(
  db: DatabaseSync,
  runId: string,
  error: string,
): Promise<void> {
  const now = new Date().toISOString();
  db.prepare('UPDATE cron_runs SET status = ?, error = ?, ended_at = ? WHERE id = ?').run(
    'failed',
    error,
    now,
    runId,
  );
}

/** 将多个执行标记为已放弃（例如启动时处理遗留的 'running' 执行） */
export async function markCronRunsAbandoned(db: DatabaseSync, runIds: string[]): Promise<void> {
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

/** 查找所有当前正在执行的运行 */
export async function findRunningCronRuns(db: DatabaseSync): Promise<CronRunRecord[]> {
  const rows = db
    .prepare("SELECT * FROM cron_runs WHERE status = 'running'")
    .all() as unknown as CronRunRow[];
  return rows.map(mapRunRow);
}

/** 查找特定任务的所有执行记录，按开始时间排序（最新的在前）。 */
export async function findCronRunsByJobId(
  db: DatabaseSync,
  jobId: string,
): Promise<CronRunRecord[]> {
  const rows = db
    .prepare('SELECT * FROM cron_runs WHERE job_id = ? ORDER BY started_at DESC')
    .all(jobId) as unknown as CronRunRow[];
  return rows.map(mapRunRow);
}
