/** 定时任务调度器 — 计算下次运行时间并管理计时器句柄。 */

import { Cron } from 'croner';
import type { CronJobRecord } from '@aesyclaw/core/types';
import { createScopedLogger } from '@aesyclaw/core/logger';

const logger = createScopedLogger('cron');

export type CronScheduleType = 'once' | 'daily' | 'interval';

export type CronCallback = (job: CronJobRecord) => void | Promise<void>;

/**
 * 定时任务调度器 — 计算下次运行时间并管理计时器句柄。
 */
export class CronScheduler {
  private readonly jobs = new Map<string, Cron>();

  /**
   * 调度一个定时任务，在 nextRun 到达时执行 callback。
   *
   * @param job - 要调度的定时任务记录
   * @param callback - 到达执行时间时调用的回调
   */
  schedule(job: CronJobRecord, callback: CronCallback): void {
    this.cancel(job.id);
    if (!job.nextRun) {
      return;
    }

    const nextRun = new Date(job.nextRun);
    if (Number.isNaN(nextRun.getTime())) {
      logger.warn('跳过 next_run 无效的定时任务', {
        jobId: job.id,
        nextRun: job.nextRun,
      });
      return;
    }

    const cronerJob = new Cron(
      nextRun.getTime() <= Date.now() ? new Date() : nextRun,
      { maxRuns: 1 },
      () => {
        this.jobs.delete(job.id);
        void callback(job);
      },
    );

    this.jobs.set(job.id, cronerJob);
    logger.debug('定时任务已调度', { jobId: job.id, nextRun: job.nextRun });
  }

  /**
   * 取消指定 ID 的定时任务计时器。
   *
   * @param jobId - 要取消的定时任务 ID
   */
  cancel(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job) {
      return;
    }
    job.stop();
    this.jobs.delete(jobId);
  }

  /** 取消所有已调度的定时任务。 */
  clearAll(): void {
    for (const job of this.jobs.values()) {
      job.stop();
    }
    this.jobs.clear();
  }

  /** 获取当前已调度的任务数量。 */
  count(): number {
    return this.jobs.size;
  }
}

/**
 * 根据调度类型和值计算下次运行时间。
 *
 * @param scheduleType - 调度类型：'once' | 'daily' | 'interval'
 * @param scheduleValue - 调度值（如 ISO 日期、'HH:MM'、'30m'）
 * @param from - 计算基准时间，默认为当前时间
 * @returns 下次运行的 Date，如果无效则返回 null
 */
export function computeNextRun(
  scheduleType: CronScheduleType,
  scheduleValue: string,
  from: Date = new Date(),
): Date | null {
  if (scheduleType === 'once') {
    const runAt = parseDate(scheduleValue);
    return runAt ? getNextCronRun(runAt, from) : null;
  }

  if (scheduleType === 'daily') {
    const pattern = dailyPattern(scheduleValue);
    return pattern ? getNextCronRun(pattern, from) : null;
  }

  if (scheduleType === 'interval') {
    const intervalMs = parseIntervalMs(scheduleValue);
    return intervalMs > 0 ? new Date(from.getTime() + intervalMs) : null;
  }

  return null;
}

function getNextCronRun(pattern: ConstructorParameters<typeof Cron>[0], from: Date): Date | null {
  try {
    const job = new Cron(pattern, { paused: true, maxRuns: 1 });
    const nextRun = job.nextRun(from);
    job.stop();
    return nextRun;
  } catch {
    return null;
  }
}

function dailyPattern(value: string): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return `${minute} ${hour} * * *`;
}

function parseIntervalMs(value: string): number {
  const trimmed = value.trim().toLowerCase();
  const match = /^(\d+)(m|h|d)?$/.exec(trimmed);
  if (!match) {
    return 0;
  }

  const amount = Number(match[1]);
  const unit = match[2] ?? 'm';
  if (!Number.isFinite(amount) || amount <= 0) {
    return 0;
  }

  if (unit === 'd') return amount * 24 * 60 * 60 * 1000;
  if (unit === 'h') return amount * 60 * 60 * 1000;
  return amount * 60 * 1000;
}

function parseDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
