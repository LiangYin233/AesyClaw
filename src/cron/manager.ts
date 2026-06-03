/** 定时任务管理器 — 持久化任务、调度计时器并记录执行历史。 */

import {
  parseSerializedSessionKey,
  type CronJobRecord,
  type OutboundSignal,
  type SessionKey,
} from '@aesyclaw/core/types';
import type {
  CronJobsRepository,
  CronRunsRepository,
  DatabaseManager,
} from '@aesyclaw/core/database/database-manager';
import type { Pipeline } from '@aesyclaw/pipeline/pipeline';
import type { IHooksBus } from '@aesyclaw/contracts/hook';
import type { SessionManager } from '@aesyclaw/session';
import { createScopedLogger } from '@aesyclaw/core/logger';
import { errorMessage } from '@aesyclaw/core/utils';
import { CronExecutor } from './executor';
import { computeNextRun, CronScheduler, type CronScheduleType } from './scheduler';

const logger = createScopedLogger('cron');

export type CronManagerDependencies = {
  databaseManager: DatabaseManager;
  pipeline: Pipeline;
  hooksBus: IHooksBus;
  sessionManager: SessionManager;
  send: (signal: OutboundSignal) => Promise<void>;
  scheduler?: CronScheduler;
};

export type CreateCronJobParams = {
  scheduleType: CronScheduleType;
  scheduleValue: string;
  prompt: string;
  sessionKey: SessionKey;
};

export type UpdateCronJobParams = Partial<{
  scheduleType: CronScheduleType;
  scheduleValue: string;
  prompt: string;
  sessionKey: SessionKey;
}>;

export type ListCronJobsFilter = {
  sessionKey?: SessionKey;
};

export class CronManager {
  private readonly cronJobs: CronJobsRepository;
  private readonly cronRuns: CronRunsRepository;
  private readonly executor: CronExecutor;
  private readonly scheduler: CronScheduler;
  private readonly hooksBus: IHooksBus;
  private readonly sessionManager: SessionManager;
  private initialized = false;
  private readonly inFlight = new Set<Promise<unknown>>();

  constructor(dependencies: CronManagerDependencies) {
    this.cronJobs = dependencies.databaseManager.cronJobs;
    this.cronRuns = dependencies.databaseManager.cronRuns;
    this.scheduler = dependencies.scheduler ?? new CronScheduler();
    this.executor = new CronExecutor(
      this.cronRuns,
      dependencies.pipeline,
      dependencies.send,
      dependencies.sessionManager,
    );
    this.hooksBus = dependencies.hooksBus;
    this.sessionManager = dependencies.sessionManager;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('CronManager 已初始化 — 跳过');
      return;
    }
    this.hooksBus.register({
      id: 'internal:cron',
      chain: 'pipeline:receive',
      priority: 200,
      enabled: true,
      handler: async (ctx, next) => {
        if (ctx.sessionKey.channel === 'cron' && ctx.sessionKey.type === 'job') {
          const existing = this.sessionManager.get(ctx.sessionKey);
          if (existing) await existing.clear();
        }
        return next !== undefined ? await next() : { action: 'next' };
      },
    });

    const running = await this.cronRuns.findRunning();
    await this.cronRuns.markAbandoned(running.map((run) => run.id));

    logger.info('CronManager 已初始化');
    this.initialized = true;
    await this.reloadSchedules();
  }

  async destroy(): Promise<void> {
    this.hooksBus.unregister('internal:cron');
    this.scheduler.clearAll();
    if (this.inFlight.size > 0) {
      logger.info('等待进行中的定时任务完成', { count: this.inFlight.size });
      await Promise.allSettled([...this.inFlight]);
    }
    logger.info('CronManager 已销毁');
  }

  async createJob(params: CreateCronJobParams): Promise<string> {
    const nextRun = computeNextRun(params.scheduleType, params.scheduleValue);
    if (!nextRun) {
      throw new Error(`无效或过期的定时任务调度: ${params.scheduleType} ${params.scheduleValue}`);
    }

    const id = await this.cronJobs.create({
      scheduleType: params.scheduleType,
      scheduleValue: params.scheduleValue,
      prompt: params.prompt,
      sessionKey: params.sessionKey,
      nextRun,
    });

    const job = await this.cronJobs.findById(id);
    if (job) {
      this.schedule(job);
    }
    logger.info('定时任务已创建', { jobId: id, scheduleType: params.scheduleType });
    return id;
  }

  async listJobs(filter: ListCronJobsFilter = {}): Promise<CronJobRecord[]> {
    const jobs = await this.cronJobs.findAll();
    const sessionKey = filter.sessionKey;
    if (!sessionKey) {
      return jobs;
    }
    return jobs.filter((job) => this.matchesSessionFilter(job, sessionKey));
  }

  private matchesSessionFilter(job: CronJobRecord, sessionKey: SessionKey): boolean {
    try {
      const jobSessionKey = parseSerializedSessionKey(job.sessionKey);
      return (
        jobSessionKey.channel === sessionKey.channel &&
        jobSessionKey.type === sessionKey.type &&
        jobSessionKey.chatId === sessionKey.chatId
      );
    } catch (err) {
      logger.warn('跳过会话密钥无效的定时任务', { jobId: job.id, error: errorMessage(err) });
      return false;
    }
  }

  async deleteJob(jobId: string): Promise<boolean> {
    const deleted = await this.cronJobs.delete(jobId);
    if (deleted) {
      this.scheduler.cancel(jobId);
      logger.info('定时任务已删除', { jobId });
    }
    return deleted;
  }

  async updateJob(jobId: string, patch: UpdateCronJobParams): Promise<CronJobRecord> {
    const current = await this.cronJobs.findById(jobId);
    if (!current) {
      throw new Error(`未找到定时任务 "${jobId}"`);
    }

    const scheduleType = patch.scheduleType ?? (current.scheduleType as CronScheduleType);
    const scheduleValue = patch.scheduleValue ?? current.scheduleValue;
    const nextRun = current.enabled ? computeNextRun(scheduleType, scheduleValue) : null;
    if (current.enabled !== false && !nextRun) {
      throw new Error(`无效或过期的定时任务调度: ${scheduleType} ${scheduleValue}`);
    }

    const updated = await this.cronJobs.update(jobId, {
      ...patch,
      nextRun,
    });
    if (!updated) {
      throw new Error(`未找到定时任务 "${jobId}"`);
    }

    this.scheduler.cancel(jobId);
    if (updated.enabled !== false && updated.nextRun) {
      this.schedule(updated);
    }
    logger.info('定时任务已更新', { jobId });
    return updated;
  }

  async setJobEnabled(jobId: string, enabled: boolean): Promise<void> {
    const current = await this.cronJobs.findById(jobId);
    if (!current) {
      throw new Error(`未找到定时任务 "${jobId}"`);
    }

    const nextRun = enabled
      ? computeNextRun(current.scheduleType as CronScheduleType, current.scheduleValue)
      : null;
    if (enabled && !nextRun) {
      throw new Error(
        `无效或过期的定时任务调度: ${current.scheduleType} ${current.scheduleValue}`,
      );
    }

    const updated = await this.cronJobs.update(jobId, { enabled, nextRun });
    if (!updated) {
      throw new Error(`未找到定时任务 "${jobId}"`);
    }

    this.scheduler.cancel(jobId);
    if (enabled && updated.nextRun) {
      this.schedule(updated);
    }
    logger.info(enabled ? '定时任务已启用' : '定时任务已禁用', { jobId });
  }

  async runJobNow(jobId: string): Promise<string> {
    const job = await this.cronJobs.findById(jobId);
    if (!job) {
      throw new Error(`未找到定时任务 "${jobId}"`);
    }
    return await this.executor.execute(job);
  }

  async reloadSchedules(): Promise<void> {
    this.scheduler.clearAll();
    const jobs = await this.cronJobs.findAll();
    let scheduledCount = 0;
    for (const job of jobs) {
      if (job.enabled === false) continue;
      const normalized = await this.normalizeReloadedJobSchedule(job);
      if (normalized?.nextRun) {
        this.schedule(normalized);
        scheduledCount += 1;
      }
    }
    logger.info('定时任务调度已加载', { count: scheduledCount, total: jobs.length });
  }

  private async normalizeReloadedJobSchedule(job: CronJobRecord): Promise<CronJobRecord | null> {
    if (job.enabled === false || !job.nextRun) {
      return null;
    }

    const persistedNextRun = new Date(job.nextRun);
    if (Number.isNaN(persistedNextRun.getTime())) {
      logger.warn('跳过 next_run 无效的定时任务', {
        jobId: job.id,
        nextRun: job.nextRun,
      });
      return null;
    }

    if (persistedNextRun.getTime() > Date.now()) {
      return job;
    }

    const nextRun = computeNextRun(job.scheduleType as CronScheduleType, job.scheduleValue);
    const jobStillExists = await this.cronJobs.updateNextRun(job.id, nextRun);
    if (!jobStillExists) {
      logger.info('定时任务已在恢复调度期间删除，跳过调度', { jobId: job.id });
      return null;
    }

    if (!nextRun) {
      logger.info('过期定时任务已清空下次运行时间', { jobId: job.id });
      return null;
    }

    logger.info('过期定时任务已推进到未来运行时间', {
      jobId: job.id,
      nextRun: nextRun.toISOString(),
    });
    return {
      ...job,
      nextRun: nextRun.toISOString(),
    };
  }

  private schedule(job: CronJobRecord): void {
    this.scheduler.schedule(job, () => {
      const run = this.executeScheduledJob(job.id).catch((err) => {
        logger.error(`定时任务 "${job.id}" 调度失败`, err);
      });
      this.trackInFlight(run);
    });
  }

  private trackInFlight(promise: Promise<unknown>): void {
    this.inFlight.add(promise);
    void promise.finally(() => {
      this.inFlight.delete(promise);
    });
  }

  private async executeScheduledJob(jobId: string): Promise<string> {
    const job = await this.cronJobs.findById(jobId);
    if (!job) {
      throw new Error(`未找到定时任务 "${jobId}"`);
    }
    if (job.enabled === false) {
      logger.info('定时任务执行完成但已禁用，跳过重新调度', { jobId: job.id });
      return await this.executor.execute(job);
    }

    let result: string;
    try {
      result = await this.executor.execute(job);
    } finally {
      const nextRun = computeNextRun(job.scheduleType as CronScheduleType, job.scheduleValue);
      const jobStillExists = await this.cronJobs.updateNextRun(job.id, nextRun);
      if (!jobStillExists) {
        logger.info('定时任务已在执行期间删除，跳过重新调度', { jobId: job.id });
      } else {
        const updated = await this.cronJobs.findById(job.id);
        if (updated && updated.enabled !== false && updated.nextRun) {
          this.schedule(updated);
        }
      }
    }
    return result;
  }
}
