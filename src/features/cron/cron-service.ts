/** @file Cron 调度服务
 *
 * CronService 实现简化后的持久化调度器，支持：
 * - 创建/删除任务
 * - 启动时恢复运行记录并跳过过期任务
 * - `once` / `daily` / `interval` 三种调度类型
 * - 单任务并发控制（同一任务不会同时执行两次）
 * - 优雅关闭（等待当前执行中的任务完成）
 *
 * 调度策略：根据 `nextRunAt` 查找最近任务，使用单个 `setTimeout` 等待触发。
 * 任务执行完成后推进下一次运行时间并重新调度。
 */

import { randomUUID } from 'crypto';
import { logger } from '@/platform/observability/logger.js';
import {
  getNextFutureRunAt,
  normalizeScheduleInput,
} from '@/platform/cron/schedule-engine.js';
import { toErrorMessage } from '@/platform/utils/errors.js';
import { cronJobRepository } from '@/platform/db/repositories/cron-job-repository.js';
import { cronRunRepository } from '@/platform/db/repositories/cron-run-repository.js';
import type { CronJob } from '@/platform/db/repositories/cron-job-repository.js';
import type { CronRun } from '@/platform/db/repositories/cron-run-repository.js';
import type {
  CreateCronJobInput,
  CronExecutor,
} from './types.js';

export type { CronJob } from '@/platform/db/repositories/cron-job-repository.js';

/** Cron 调度服务 */
export class CronService {
  private running = false;
  private nextTimeoutId: NodeJS.Timeout | null = null;
  private activeJobs = new Set<string>();
  private activeJobPromises = new Map<string, Promise<void>>();
  private executor: CronExecutor | null = null;

  /** 设置任务执行器（必须在 start() 前调用） */
  setExecutor(executor: CronExecutor): void {
    this.executor = executor;
  }

  /** 创建定时任务 */
  createJob(input: CreateCronJobInput): CronJob {
    this.assertValidPrompt(input.prompt);
    const { schedule, nextRunAt } = normalizeScheduleInput(input.schedule);

    const job = cronJobRepository.create({
      id: randomUUID(),
      name: input.name,
      schedule,
      prompt: input.prompt,
      nextRunAt,
    });

    this.rescheduleIfRunning();
    return job;
  }

  /** 列出所有定时任务 */
  listJobs(): CronJob[] {
    return cronJobRepository.findAll();
  }

  /** 删除定时任务 */
  deleteJob(id: string): boolean {
    const deleted = cronJobRepository.delete(id);
    if (deleted) {
      this.rescheduleIfRunning();
    }
    return deleted;
  }

  /** 启动调度器 */
  start(): void {
    if (this.running) {
      logger.warn({}, 'Cron service already running');
      return;
    }

    this.running = true;
    this.recoverOnStart();
    this.rebuildSchedules();
    this.scheduleNext();
    logger.info({}, 'Cron service started');
  }

  /** 停止调度器，等待当前执行中的任务完成 */
  async stop(): Promise<void> {
    this.running = false;

    if (this.nextTimeoutId) {
      clearTimeout(this.nextTimeoutId);
      this.nextTimeoutId = null;
    }

    const pending = Array.from(this.activeJobPromises.values());
    if (pending.length > 0) {
      logger.info({ activeJobCount: pending.length }, 'Waiting for active cron jobs to complete');
      await Promise.allSettled(pending);
    }

    logger.info({}, 'Cron service stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  /** 获取当前已调度的任务数量 */
  getScheduledTaskCount(): number {
    return cronJobRepository.findScheduled().length;
  }

  /** 启动时恢复：将上次运行中未完成的任务标记为 abandoned */
  private recoverOnStart(): void {
    const now = new Date().toISOString();
    cronRunRepository.markAllRunningAsAbandoned(now);
  }

  /** 重建调度计划：将已过期的下次运行时间重新计算 */
  private rebuildSchedules(): void {
    const now = new Date();
    for (const job of cronJobRepository.findScheduled()) {
      const nextRunAt = job.nextRunAt ? new Date(job.nextRunAt) : null;
      if (nextRunAt && nextRunAt.getTime() > now.getTime()) {
        continue;
      }

      const nextScheduledAt = getNextFutureRunAt(job.schedule, now, job.nextRunAt);
      cronJobRepository.updateSchedule(job.id, {
        nextRunAt: nextScheduledAt,
      });
    }
  }

  /** 若调度器正在运行，重新调度下一个任务 */
  private rescheduleIfRunning(): void {
    if (!this.running) {return;}
    this.scheduleNext();
  }

  /** 查找下一个将要运行的任务（跳过正在执行中的） */
  private findNextJobToSchedule(): CronJob | null {
    for (const job of cronJobRepository.findScheduled()) {
      if (!job.nextRunAt) {
        continue;
      }

      if (this.activeJobs.has(job.id)) {
        continue;
      }

      return job;
    }

    return null;
  }

  /** 调度下一个到期任务
   *
   * 找到最近到期的任务，计算延迟并设置 setTimeout。
   * 任务执行完成后会自动再次调用 scheduleNext()。
   */
  private scheduleNext(): void {
    if (!this.running) {return;}

    if (this.nextTimeoutId) {
      clearTimeout(this.nextTimeoutId);
      this.nextTimeoutId = null;
    }

    const nowMs = Date.now();
    const nextJob = this.findNextJobToSchedule();
    if (!nextJob?.nextRunAt) {
      logger.debug({}, 'No scheduled cron jobs');
      return;
    }

    const delay = Math.max(0, new Date(nextJob.nextRunAt).getTime() - nowMs);
    logger.debug({ jobId: nextJob.id, delayMs: delay }, 'Next cron job scheduled');

    this.nextTimeoutId = setTimeout(() => {
      this.nextTimeoutId = null;
      this.runDueJobs();
    }, delay);
  }

  /** 执行所有到期的任务 */
  private runDueJobs(): void {
    if (!this.running) {return;}

    const now = new Date().toISOString();
    const dueJobs = cronJobRepository.findDue(now);
    let startedCount = 0;

    for (const job of dueJobs) {
      if (this.activeJobs.has(job.id)) {
        logger.debug({ jobId: job.id }, 'Cron job already running, skipping');
        continue;
      }
      this.executeJob(job);
      startedCount += 1;
    }

    if (startedCount === 0) {
      this.scheduleNext();
    }
  }

  /** 执行单个任务
   *
   * 标记任务为活跃，创建运行记录，调用执行器，
   * 完成后更新调度计划并重新调度。
   */
  private executeJob(job: CronJob): void {
    this.activeJobs.add(job.id);

    const startedAt = new Date().toISOString();
    const run = cronRunRepository.createRunning(job.id, startedAt);
    cronJobRepository.updateSchedule(job.id, { lastRunAt: startedAt });

    const jobPromise = this.runExecutor(job, run, startedAt)
      .catch(() => {
        // Errors are already logged and recorded inside runExecutor
      })
      .finally(() => {
        this.activeJobs.delete(job.id);
        this.activeJobPromises.delete(job.id);
        this.scheduleNext();
      });

    this.activeJobPromises.set(job.id, jobPromise);
  }

  /** 调用执行器运行任务 */
  private async runExecutor(job: CronJob, run: CronRun, startedAt: string): Promise<void> {
    if (!this.executor) {
      const error = 'Cron executor is not configured';
      cronRunRepository.finish(run.id, 'failed', new Date().toISOString(), error);
      logger.error({ jobId: job.id }, error);
      this.advanceSchedule(job, new Date(), startedAt);
      return;
    }

    try {
      logger.info({ jobId: job.id, jobName: job.name }, 'Executing cron job');
      await this.executor.execute(job);
      cronRunRepository.finish(run.id, 'succeeded', new Date().toISOString());
      logger.info({ jobId: job.id }, 'Cron job executed successfully');
    } catch (error) {
      const errorMessage = toErrorMessage(error);
      cronRunRepository.finish(run.id, 'failed', new Date().toISOString(), errorMessage);
      logger.error({ jobId: job.id, error: errorMessage }, 'Cron job execution failed');
    }

    this.advanceSchedule(job, new Date(), startedAt);
  }

  /** 推进任务的调度计划：计算下次运行时间 */
  private advanceSchedule(job: CronJob, referenceTime: Date, startedAt: string): void {
    const nextRunAt = getNextFutureRunAt(job.schedule, referenceTime, job.nextRunAt);
    cronJobRepository.updateSchedule(job.id, {
      lastRunAt: startedAt,
      nextRunAt,
    });

    if (nextRunAt === null) {
      logger.info({ jobId: job.id, scheduleType: job.schedule.type }, 'Cron job reached terminal schedule state');
    }
  }

  private assertValidPrompt(prompt: string): void {
    if (!prompt || prompt.trim().length === 0) {
      throw new Error('Prompt is required for cron job execution');
    }
  }
}

export const cronService = new CronService();
