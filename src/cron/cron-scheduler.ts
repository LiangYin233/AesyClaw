/** Cron scheduler — computes next run times and owns timer handles. */

import type { CronJobRecord } from '../core/types';
import { createScopedLogger } from '../core/logger';

const logger = createScopedLogger('cron');

export type CronScheduleType = 'once' | 'daily' | 'interval';

export type CronCallback = (job: CronJobRecord) => void | Promise<void>;

const MAX_TIMEOUT_MS = 2_147_483_647;

export class CronScheduler {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  schedule(job: CronJobRecord, callback: CronCallback): void {
    this.cancel(job.id);
    if (!job.nextRun) {
      return;
    }

    const nextRun = new Date(job.nextRun);
    const delay = Math.max(0, nextRun.getTime() - Date.now());
    const timeout = Math.min(delay, MAX_TIMEOUT_MS);
    const timer = setTimeout(() => {
      this.timers.delete(job.id);
      if (delay > MAX_TIMEOUT_MS) {
        this.schedule(job, callback);
        return;
      }
      void callback(job);
    }, timeout);

    this.timers.set(job.id, timer);
    logger.debug('Cron job scheduled', { jobId: job.id, nextRun: job.nextRun });
  }

  cancel(jobId: string): void {
    const timer = this.timers.get(jobId);
    if (!timer) {
      return;
    }
    clearTimeout(timer);
    this.timers.delete(jobId);
  }

  clearAll(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  count(): number {
    return this.timers.size;
  }
}

export function computeNextRun(
  scheduleType: string,
  scheduleValue: string,
  from: Date = new Date(),
): Date | null {
  if (scheduleType === 'once') {
    const runAt = parseDate(scheduleValue);
    return runAt && runAt.getTime() > from.getTime() ? runAt : null;
  }

  if (scheduleType === 'daily') {
    return computeNextDailyRun(scheduleValue, from);
  }

  if (scheduleType === 'interval') {
    const intervalMs = parseIntervalMs(scheduleValue);
    return intervalMs > 0 ? new Date(from.getTime() + intervalMs) : null;
  }

  return null;
}

function computeNextDailyRun(value: string, from: Date): Date | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  const next = new Date(from);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= from.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next;
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
