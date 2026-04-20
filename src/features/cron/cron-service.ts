/** @file Cron 调度服务
 *
 * CronService 实现基于内存的定时任务调度引擎，支持：
 * - 创建/删除/更新/切换启用的定时任务
 * - 启动时恢复状态（将上次运行中标记为 running 的记录标记为 abandoned）
 * - 重建调度计划（将过期的下次运行时间重新计算）
 * - 单任务并发控制（同一任务不会同时执行两次）
 * - 优雅关闭（等待当前执行中的任务完成）
 *
 * 调度策略：遍历所有已启用任务，找到最近到期的任务，设置 setTimeout 等待执行。
 * 任务执行完成后重新调度下一个任务。
 */

import { randomUUID } from 'crypto';
import { logger } from '@/platform/observability/logger.js';
import { toErrorMessage } from '@/platform/utils/errors.js';
import { validateExpression, getNextRunAt } from '@/platform/cron/schedule-engine.js';
import { cronJobRepository } from '@/platform/db/repositories/cron-job-repository.js';
import { cronRunRepository } from '@/platform/db/repositories/cron-run-repository.js';
import type { CronJob } from '@/platform/db/repositories/cron-job-repository.js';
import type { CronRun } from '@/platform/db/repositories/cron-run-repository.js';
import type {
  CreateCronJobInput,
  UpdateCronJobInput,
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
    this.assertValidCronExpression(input.cronExpression);

    const job = cronJobRepository.create({
      id: randomUUID(),
      name: input.name,
      cronExpression: input.cronExpression,
      prompt: input.prompt,
      nextRunAt: getNextRunAt(input.cronExpression) || undefined,
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

  /** 启用/禁用定时任务 */
  toggleJob(id: string, enabled: boolean): CronJob | null {
    const job = cronJobRepository.findById(id);
    if (!job) return null;

    const nextRunAt = enabled ? getNextRunAt(job.cronExpression) : null;
    const updated = cronJobRepository.update(id, {
      enabled,
      nextRunAt: enabled ? nextRunAt || undefined : null,
    });

    this.rescheduleIfRunning();
    return updated;
  }

  /** 更新定时任务 */
  updateJob(id: string, updates: UpdateCronJobInput): CronJob | null {
    const existing = cronJobRepository.findById(id);
    if (!existing) return null;

    if (updates.prompt !== undefined) {
      this.assertValidPrompt(updates.prompt);
    }
    if (updates.cronExpression !== undefined) {
      this.assertValidCronExpression(updates.cronExpression);
    }

    const cronExpression = updates.cronExpression ?? existing.cronExpression;
    const nextRunAt = existing.enabled ? getNextRunAt(cronExpression) : existing.nextRunAt;

    const updated = cronJobRepository.update(id, {
      ...updates,
      nextRunAt: nextRunAt || null,
    });

    this.rescheduleIfRunning();
    return updated;
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
    return cronJobRepository.findEnabled().filter(job => Boolean(job.nextRunAt)).length;
  }

  /** 验证 Cron 表达式是否有效 */
  validateCronExpression(expression: string): boolean {
    return validateExpression(expression);
  }

  /** 启动时恢复：将上次运行中未完成的任务标记为 abandoned */
  private recoverOnStart(): void {
    const now = new Date().toISOString();
    cronRunRepository.markAllRunningAsAbandoned(now);
  }

  /** 重建调度计划：将已过期的下次运行时间重新计算 */
  private rebuildSchedules(): void {
    const now = new Date();
    for (const job of cronJobRepository.findEnabled()) {
      const nextRunAt = job.nextRunAt ? new Date(job.nextRunAt) : null;
      if (nextRunAt && nextRunAt.getTime() > now.getTime()) {
        continue;
      }

      const nextScheduledAt = getNextRunAt(job.cronExpression, now);
      cronJobRepository.updateSchedule(job.id, {
        nextRunAt: nextScheduledAt,
      });
    }
  }

  /** 若调度器正在运行，重新调度下一个任务 */
  private rescheduleIfRunning(): void {
    if (!this.running) return;
    this.scheduleNext();
  }

  /** 查找下一个可调度且已到期的任务 */
  private findNextSchedulableJob(referenceTimeMs: number): CronJob | null {
    for (const job of cronJobRepository.findEnabled()) {
      if (!job.nextRunAt) {
        continue;
      }

      const isDue = new Date(job.nextRunAt).getTime() <= referenceTimeMs;
      if (isDue && this.activeJobs.has(job.id)) {
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
    if (!this.running) return;

    if (this.nextTimeoutId) {
      clearTimeout(this.nextTimeoutId);
      this.nextTimeoutId = null;
    }

    const nowMs = Date.now();
    const nextJob = this.findNextSchedulableJob(nowMs);
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
    if (!this.running) return;

    const now = new Date().toISOString();
    const dueJobs = cronJobRepository.findDue(now);

    for (const job of dueJobs) {
      if (this.activeJobs.has(job.id)) {
        logger.debug({ jobId: job.id }, 'Cron job already running, skipping');
        continue;
      }
      this.executeJob(job);
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
      this.advanceSchedule(job, startedAt);
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

    this.advanceSchedule(job, startedAt);
  }

  /** 推进任务的调度计划：计算下次运行时间 */
  private advanceSchedule(job: CronJob, startedAt: string): void {
    const nextRunAt = getNextRunAt(job.cronExpression, new Date());
    cronJobRepository.updateSchedule(job.id, {
      lastRunAt: startedAt,
      nextRunAt,
    });

    if (nextRunAt === null) {
      logger.warn({ jobId: job.id }, 'Cron job disabled because no next run time could be calculated');
    }
  }

  private assertValidCronExpression(expression: string): void {
    if (!validateExpression(expression)) {
      throw new Error(`Invalid cron expression: ${expression}`);
    }
  }

  private assertValidPrompt(prompt: string): void {
    if (!prompt || prompt.trim().length === 0) {
      throw new Error('Prompt is required for cron job execution');
    }
  }
}

export const cronService = new CronService();
