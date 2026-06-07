/**
 * CronRepository — cron_jobs 和 cron_runs 表的数据访问层。
 *
 * 包含定时任务和定时任务执行的数据库操作函数。
 * 所有函数均返回 Promise 以保持一致异步模式。
 */

import { randomUUID } from 'node:crypto';
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
  enabled?: number;
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

export class CronJobRepository extends BaseRepository<CronJobRecord, CronJobRow> {
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
      enabled: row['enabled'] !== 0,
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
    if (entity['enabled'] !== undefined) fields['enabled'] = entity['enabled'] ? 1 : 0;
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

  /** 更新定时任务字段并返回更新后的记录。 */
  async updateJob(
    id: string,
    patch: Partial<{
      scheduleType: string;
      scheduleValue: string;
      prompt: string;
      sessionKey: SessionKey | string;
      nextRun: Date | string | null;
      enabled: boolean;
    }>,
  ): Promise<CronJobRecord | null> {
    const fields: Record<string, unknown> = {};
    if (patch.scheduleType !== undefined) fields['schedule_type'] = patch.scheduleType;
    if (patch.scheduleValue !== undefined) fields['schedule_value'] = patch.scheduleValue;
    if (patch.prompt !== undefined) fields['prompt'] = patch.prompt;
    if (patch.sessionKey !== undefined) {
      fields['session_key'] =
        typeof patch.sessionKey === 'string' ? patch.sessionKey : serializeSessionKey(patch.sessionKey);
    }
    if (patch.nextRun !== undefined) {
      fields['next_run'] = patch.nextRun instanceof Date ? patch.nextRun.toISOString() : patch.nextRun;
    }
    if (patch.enabled !== undefined) fields['enabled'] = patch.enabled ? 1 : 0;

    const columns = Object.keys(fields);
    if (columns.length > 0) {
      const values = [...Object.values(fields), id] as Array<string | number | null | Uint8Array>;
      const setClause = columns.map((column) => `${column} = ?`).join(', ');
      const result = this.exec(`UPDATE cron_jobs SET ${setClause} WHERE id = ?`, ...values);
      if (result.changes === 0) return null;
    }

    return await this.findById(id);
  }

  /** 设置定时任务启用状态。 */
  async setEnabled(id: string, enabled: boolean): Promise<boolean> {
    const result = this.exec('UPDATE cron_jobs SET enabled = ? WHERE id = ?', enabled ? 1 : 0, id);
    return result.changes > 0;
  }
}

// ─── 定时任务执行仓储 ────────────────────────────────────────────

export class CronRunRepository extends BaseRepository<CronRunRecord, CronRunRow> {
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
        this.exec(
          'UPDATE cron_runs SET status = ?, ended_at = ? WHERE id = ?',
          'abandoned',
          now,
          id,
        );
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

// ─── 公共 API ───────────────────────────────────────────────────

/** 可导出的仓储类，供 DatabaseManager 直接使用。 */
// CronJobRepository 和 CronRunRepository 已在类定义处导出，无需额外导出。
