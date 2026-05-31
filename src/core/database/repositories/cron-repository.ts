/**
 * CronRepository — cron_jobs 和 cron_runs 表的数据访问层。
 *
 * 包含定时任务和定时任务执行的数据库操作函数。
 * 所有函数均返回 Promise 以保持一致异步模式。
 */

import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  serializeSessionKey,
  type CronJobRecord,
  type CronRunRecord,
  type SessionKey,
} from '@aesyclaw/core/types';
import { BaseRepository } from './base-repository';

// ─── 行类型 ─────────────────────────────────────────────────────

type CronJobRow = {
  id: string;
  schedule_type: string;
  schedule_value: string;
  prompt: string;
  session_key: string;
  next_run: string | null;
  created_at: string;
};

type CronRunRow = {
  id: string;
  job_id: string;
  status: string;
  result: string | null;
  error: string | null;
  started_at: string;
  ended_at: string | null;
};

// ─── 定时任务仓储 ────────────────────────────────────────────────

class CronJobRepositoryImpl extends BaseRepository<CronJobRecord, CronJobRow> {
  protected getTableName(): string {
    return 'cron_jobs';
  }

  protected getPrimaryKey(): string {
    return 'id';
  }

  protected mapRow(row: CronJobRow): CronJobRecord {
    return {
      id: row['id'],
      scheduleType: row['schedule_type'],
      scheduleValue: row['schedule_value'],
      prompt: row['prompt'],
      sessionKey: row['session_key'],
      nextRun: row['next_run'],
      createdAt: row['created_at'],
    };
  }

  protected mapToFields(entity: Partial<CronJobRecord>): Record<string, unknown> {
    const fields: Record<string, unknown> = {};
    if (entity['id'] !== undefined) fields['id'] = entity['id'];
    if (entity['scheduleType'] !== undefined) fields['schedule_type'] = entity['scheduleType'];
    if (entity['scheduleValue'] !== undefined) fields['schedule_value'] = entity['scheduleValue'];
    if (entity['prompt'] !== undefined) fields['prompt'] = entity['prompt'];
    if (entity['sessionKey'] !== undefined) fields['session_key'] = entity['sessionKey'];
    if (entity['nextRun'] !== undefined) fields['next_run'] = entity['nextRun'];
    if (entity['createdAt'] !== undefined) fields['created_at'] = entity['createdAt'];
    return fields;
  }

  /** 创建一个新的定时任务并返回其生成的 ID。 */
  async createJob(params: {
    scheduleType: string;
    scheduleValue: string;
    prompt: string;
    sessionKey: SessionKey;
    nextRun: Date | null;
  }): Promise<string> {
    const id = randomUUID();
    const sessionKeyJson = serializeSessionKey(params.sessionKey);
    const nextRunStr = params.nextRun?.toISOString() ?? null;
    const now = new Date().toISOString();

    this.exec(
      'INSERT INTO cron_jobs (id, schedule_type, schedule_value, prompt, session_key, next_run, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
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

  /** 按 ID 删除定时任务及其关联执行记录。 */
  async deleteWithRuns(id: string): Promise<boolean> {
    return await this.transactionAsync(async () => {
      this.exec('DELETE FROM cron_runs WHERE job_id = ?', id);
      const result = this.exec('DELETE FROM cron_jobs WHERE id = ?', id);
      return result.changes > 0;
    });
  }

  /** 更新定时任务的 next_run 时间。 */
  async updateNextRun(id: string, nextRun: Date | null): Promise<boolean> {
    const nextRunStr = nextRun?.toISOString() ?? null;
    const result = this.exec('UPDATE cron_jobs SET next_run = ? WHERE id = ?', nextRunStr, id);
    return result.changes > 0;
  }
}

// ─── 定时任务执行仓储 ────────────────────────────────────────────

class CronRunRepositoryImpl extends BaseRepository<CronRunRecord, CronRunRow> {
  protected getTableName(): string {
    return 'cron_runs';
  }

  protected getPrimaryKey(): string {
    return 'id';
  }

  protected mapRow(row: CronRunRow): CronRunRecord {
    return {
      id: row['id'],
      jobId: row['job_id'],
      status: row['status'],
      result: row['result'],
      error: row['error'],
      startedAt: row['started_at'],
      endedAt: row['ended_at'],
    };
  }

  protected mapToFields(entity: Partial<CronRunRecord>): Record<string, unknown> {
    const fields: Record<string, unknown> = {};
    if (entity['id'] !== undefined) fields['id'] = entity['id'];
    if (entity['jobId'] !== undefined) fields['job_id'] = entity['jobId'];
    if (entity['status'] !== undefined) fields['status'] = entity['status'];
    if (entity['result'] !== undefined) fields['result'] = entity['result'];
    if (entity['error'] !== undefined) fields['error'] = entity['error'];
    if (entity['startedAt'] !== undefined) fields['started_at'] = entity['startedAt'];
    if (entity['endedAt'] !== undefined) fields['ended_at'] = entity['endedAt'];
    return fields;
  }

  /** 创建一个新的定时任务执行记录。 */
  async createRun(params: { jobId: string }): Promise<string> {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.exec(
      'INSERT INTO cron_runs (id, job_id, status, started_at) VALUES (?, ?, ?, ?)',
      id,
      params.jobId,
      'running',
      now,
    );

    return id;
  }

  /** 将执行记录标记为已完成。 */
  async markCompleted(runId: string, result: string): Promise<void> {
    const now = new Date().toISOString();
    this.exec(
      'UPDATE cron_runs SET status = ?, result = ?, ended_at = ? WHERE id = ?',
      'completed',
      result,
      now,
      runId,
    );
  }

  /** 将执行记录标记为失败。 */
  async markFailed(runId: string, error: string): Promise<void> {
    const now = new Date().toISOString();
    this.exec(
      'UPDATE cron_runs SET status = ?, error = ?, ended_at = ? WHERE id = ?',
      'failed',
      error,
      now,
      runId,
    );
  }

  /** 将多个执行记录标记为已放弃。 */
  async markAbandoned(runIds: string[]): Promise<void> {
    if (runIds.length === 0) return;

    const now = new Date().toISOString();

    await this.transactionAsync(async () => {
      for (const id of runIds) {
        this.exec('UPDATE cron_runs SET status = ?, ended_at = ? WHERE id = ?', 'abandoned', now, id);
      }
    });
  }

  /** 查找所有当前正在执行的运行记录。 */
  async findRunning(): Promise<CronRunRecord[]> {
    const rows = this.query<CronRunRow>("SELECT * FROM cron_runs WHERE status = 'running'");
    return rows.map((row) => this.mapRow(row));
  }

  /** 查找特定任务的所有执行记录。 */
  async findByJobId(jobId: string): Promise<CronRunRecord[]> {
    const rows = this.query<CronRunRow>(
      'SELECT * FROM cron_runs WHERE job_id = ? ORDER BY started_at DESC',
      jobId,
    );
    return rows.map((row) => this.mapRow(row));
  }
}

// ─── 公共 API - 定时任务 ─────────────────────────────────────────

/** 创建一个新的定时任务并返回其生成的 ID。 */
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
  const repo = new CronJobRepositoryImpl(db);
  return await repo.createJob(params);
}

/** 按 ID 查找定时任务。 */
export async function findCronJobById(db: DatabaseSync, id: string): Promise<CronJobRecord | null> {
  const repo = new CronJobRepositoryImpl(db);
  return await repo.findById(id);
}

/** 获取所有定时任务。 */
export async function findAllCronJobs(db: DatabaseSync): Promise<CronJobRecord[]> {
  const repo = new CronJobRepositoryImpl(db);
  return await repo.findAll('next_run ASC');
}

/** 按 ID 删除定时任务及其关联执行记录。 */
export async function deleteCronJob(db: DatabaseSync, id: string): Promise<boolean> {
  const repo = new CronJobRepositoryImpl(db);
  return await repo.deleteWithRuns(id);
}

/** 更新定时任务的 next_run 时间。 */
export async function updateCronJobNextRun(
  db: DatabaseSync,
  id: string,
  nextRun: Date | null,
): Promise<boolean> {
  const repo = new CronJobRepositoryImpl(db);
  return await repo.updateNextRun(id, nextRun);
}

// ─── 公共 API - 定时任务执行 ─────────────────────────────────────

/** 创建一个新的定时任务执行记录。 */
export async function createCronRun(db: DatabaseSync, params: { jobId: string }): Promise<string> {
  const repo = new CronRunRepositoryImpl(db);
  return await repo.createRun(params);
}

/** 将执行记录标记为已完成。 */
export async function markCronRunCompleted(
  db: DatabaseSync,
  runId: string,
  result: string,
): Promise<void> {
  const repo = new CronRunRepositoryImpl(db);
  return await repo.markCompleted(runId, result);
}

/** 将执行记录标记为失败。 */
export async function markCronRunFailed(
  db: DatabaseSync,
  runId: string,
  error: string,
): Promise<void> {
  const repo = new CronRunRepositoryImpl(db);
  return await repo.markFailed(runId, error);
}

/** 将多个执行记录标记为已放弃。 */
export async function markCronRunsAbandoned(db: DatabaseSync, runIds: string[]): Promise<void> {
  const repo = new CronRunRepositoryImpl(db);
  return await repo.markAbandoned(runIds);
}

/** 查找所有当前正在执行的运行记录。 */
export async function findRunningCronRuns(db: DatabaseSync): Promise<CronRunRecord[]> {
  const repo = new CronRunRepositoryImpl(db);
  return await repo.findRunning();
}

/** 查找特定任务的所有执行记录。 */
export async function findCronRunsByJobId(
  db: DatabaseSync,
  jobId: string,
): Promise<CronRunRecord[]> {
  const repo = new CronRunRepositoryImpl(db);
  return await repo.findByJobId(jobId);
}
