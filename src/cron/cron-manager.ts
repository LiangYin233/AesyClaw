/** 定时任务管理器 — 持久化任务、调度计时器并记录执行历史。 */

import {
  parseSerializedSessionKey,
  type CronJobRecord,
  type Message,
  type SessionKey,
} from '@aesyclaw/core/types';
import type {
  CronJobsRepository,
  CronRunsRepository,
  DatabaseManager,
} from '@aesyclaw/core/database/database-manager';
import type { Pipeline } from '@aesyclaw/pipeline/pipeline';
import { createScopedLogger } from '@aesyclaw/core/logger';
import { errorMessage, requireInitialized } from '@aesyclaw/core/utils';
import { CronExecutor } from './cron-executor';
import { computeNextRun, CronScheduler, type CronScheduleType } from './cron-scheduler';

const logger = createScopedLogger('cron');

export type CronManagerDependencies = {
  databaseManager: DatabaseManager;
  pipeline: Pick<Pipeline, 'receiveWithSend'>;
  send: (sessionKey: SessionKey, message: Message) => Promise<void>;
  scheduler?: CronScheduler;
};

export type CreateCronJobParams = {
  scheduleType: CronScheduleType;
  scheduleValue: string;
  prompt: string;
  sessionKey: SessionKey;
};

export type ListCronJobsFilter = {
  sessionKey?: SessionKey;
};

type CronManagerStoredDeps = {
  cronJobs: CronJobsRepository;
  cronRuns: CronRunsRepository;
  executor: CronExecutor;
  scheduler: CronScheduler;
};

export class CronManager {
  private deps: CronManagerStoredDeps | null = null;
  private readonly inFlight = new Set<Promise<unknown>>();

  async initialize(dependencies: CronManagerDependencies): Promise<void> {
    if (this.deps) {
      logger.warn('CronManager 已初始化 — 跳过');
      return;
    }

    const cronJobs = dependencies.databaseManager.cronJobs;
    const cronRuns = dependencies.databaseManager.cronRuns;
    const scheduler = dependencies.scheduler ?? new CronScheduler();
    const executor = new CronExecutor(cronRuns, dependencies.pipeline, dependencies.send);

    const running = await cronRuns.findRunning();
    await cronRuns.markAbandoned(running.map((run) => run.id));

    this.deps = { cronJobs, cronRuns, executor, scheduler };
    logger.info('CronManager 已初始化');
    await this.reloadSchedules();
  }

  async destroy(): Promise<void> {
    const deps = this.requireDeps();
    deps.scheduler.clearAll();
    if (this.inFlight.size > 0) {
      logger.info('等待进行中的定时任务完成', { count: this.inFlight.size });
      await Promise.allSettled([...this.inFlight]);
    }
    this.deps = null;
    logger.info('CronManager 已销毁');
  }

  private requireDeps(): CronManagerStoredDeps {
    return requireInitialized(this.deps, 'CronManager');
  }

  async createJob(params: CreateCronJobParams): Promise<string> {
    this.requireDeps();
    const nextRun = computeNextRun(params.scheduleType, params.scheduleValue);
    if (!nextRun) {
      throw new Error(`无效或过期的定时任务调度: ${params.scheduleType} ${params.scheduleValue}`);
    }

    const cronJobs = this.requireDeps().cronJobs;
    const id = await cronJobs.create({
      scheduleType: params.scheduleType,
      scheduleValue: params.scheduleValue,
      prompt: params.prompt,
      sessionKey: params.sessionKey,
      nextRun,
    });

    const job = await cronJobs.findById(id);
    if (job) {
      this.schedule(job);
    }
    logger.info('定时任务已创建', { jobId: id, scheduleType: params.scheduleType });
    return id;
  }

  async listJobs(filter: ListCronJobsFilter = {}): Promise<CronJobRecord[]> {
    const jobs = await this.requireDeps().cronJobs.findAll();
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
    const deps = this.requireDeps();
    const deleted = await deps.cronJobs.delete(jobId);
    if (deleted) {
      deps.scheduler.cancel(jobId);
      logger.info('定时任务已删除', { jobId });
    }
    return deleted;
  }

  async runJobNow(jobId: string): Promise<string> {
    const deps = this.requireDeps();
    const job = await deps.cronJobs.findById(jobId);
    if (!job) {
      throw new Error(`未找到定时任务 "${jobId}"`);
    }
    return await deps.executor.execute(job);
  }

  async reloadSchedules(): Promise<void> {
    const deps = this.requireDeps();
    deps.scheduler.clearAll();
    const jobs = await deps.cronJobs.findAll();
    let scheduledCount = 0;
    for (const job of jobs) {
      const normalized = await this.normalizeReloadedJobSchedule(job);
      if (normalized?.nextRun) {
        this.schedule(normalized);
        scheduledCount += 1;
      }
    }
    logger.info('定时任务调度已加载', { count: scheduledCount, total: jobs.length });
  }

  private async normalizeReloadedJobSchedule(job: CronJobRecord): Promise<CronJobRecord | null> {
    if (!job.nextRun) {
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
    const jobStillExists = await this.requireDeps().cronJobs.updateNextRun(job.id, nextRun);
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
    this.requireDeps().scheduler.schedule(job, () => {
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
    const deps = this.requireDeps();
    const job = await deps.cronJobs.findById(jobId);
    if (!job) {
      throw new Error(`未找到定时任务 "${jobId}"`);
    }

    let result: string;
    try {
      result = await deps.executor.execute(job);
    } finally {
      const nextRun = computeNextRun(job.scheduleType as CronScheduleType, job.scheduleValue);
      const jobStillExists = await deps.cronJobs.updateNextRun(job.id, nextRun);
      if (!jobStillExists) {
        logger.info('定时任务已在执行期间删除，跳过重新调度', { jobId: job.id });
      } else {
        const updated = await deps.cronJobs.findById(job.id);
        if (updated?.nextRun) {
          this.schedule(updated);
        }
      }
    }
    return result;
  }
}
