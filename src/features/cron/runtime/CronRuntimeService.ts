import { CronExpressionParser } from 'cron-parser';
import { logger } from '../../../platform/observability/index.js';
import type { CronJob } from '../domain/cronTypes.js';
import { CronStore } from '../infrastructure/CronStore.js';

const FAILED_JOB_RETRY_DELAY_MS = 60_000;
const MAX_CATCH_UP_DELAY_MS = 60_000;

export class CronRuntimeService {
  private jobs: Map<string, CronJob> = new Map();
  private timer?: NodeJS.Timeout;
  private store: CronStore;
  private onJobExecute?: (job: CronJob) => Promise<void>;
  private log = logger.child('Cron');
  private readyPromise?: Promise<void>;
  private ready = false;
  private started = false;

  constructor(
    dbPath: string,
    onJobExecute?: (job: CronJob) => Promise<void>
  ) {
    const actualDbPath = dbPath.replace(/\.json$/, '.db');
    this.store = new CronStore(actualDbPath);
    this.onJobExecute = onJobExecute;
  }

  async addJob(job: CronJob): Promise<CronJob> {
    await this.ensureReady();
    this.computeNextRun(job);
    await this.store.upsert(job);
    this.jobs.set(job.id, job);
    if (this.started) {
      this.wakeUp();
    }
    return job;
  }

  async saveJob(job: CronJob): Promise<CronJob> {
    await this.ensureReady();
    this.computeNextRun(job);
    await this.store.upsert(job);
    this.jobs.set(job.id, job);
    if (this.started) {
      this.wakeUp();
    }
    return job;
  }

  async removeJob(id: string): Promise<boolean> {
    await this.ensureReady();
    if (!this.jobs.has(id)) {
      return false;
    }

    const removed = await this.store.delete(id);
    if (!removed) {
      return false;
    }

    this.jobs.delete(id);
    if (this.started) {
      this.wakeUp();
    }
    return true;
  }

  async enableJob(id: string, enabled: boolean): Promise<void> {
    await this.ensureReady();
    const job = this.jobs.get(id);
    if (!job) {
      return;
    }

    const nextRunAtMs = this.computeNextRunForState(job, enabled);
    await this.store.updateStatus(id, enabled, nextRunAtMs);

    job.enabled = enabled;
    job.nextRunAtMs = nextRunAtMs;
    if (this.started) {
      this.wakeUp();
    }
  }

  async getJob(id: string): Promise<CronJob | undefined> {
    await this.ensureReady();
    return this.jobs.get(id);
  }

  async listJobs(): Promise<CronJob[]> {
    await this.ensureReady();
    return Array.from(this.jobs.values()).map((job) => ({
      ...job,
      payload: { ...job.payload, detail: '[隐藏]' }
    }));
  }

  async start(): Promise<void> {
    await this.ensureReady();
    if (this.started) {
      return;
    }

    this.started = true;
    this.scheduleNext();
  }

  stop(): void {
    this.started = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.store.close().catch(() => {});
  }

  private wakeUp(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.scheduleNext();
  }

  private async ensureReady(): Promise<void> {
    if (this.ready) {
      return;
    }

    if (!this.readyPromise) {
      this.readyPromise = (async () => {
        await this.store.initialize();
        await this.load();
        this.ready = true;
      })();
    }

    await this.readyPromise;
  }

  private computeNextRunForState(job: CronJob, enabled: boolean): number | undefined {
    if (!enabled) {
      return undefined;
    }

    const nextJob: CronJob = {
      ...job,
      enabled,
      schedule: { ...job.schedule },
      payload: { ...job.payload }
    };
    this.computeNextRun(nextJob);
    return nextJob.nextRunAtMs;
  }

  private scheduleNext(): void {
    const now = Date.now();
    let nearest = Infinity;

    for (const job of this.jobs.values()) {
      if (job.enabled && job.nextRunAtMs && job.nextRunAtMs < nearest) {
        nearest = job.nextRunAtMs;
      }
    }

    if (nearest === Infinity) {
      return;
    }

    const delay = Math.max(0, nearest - now);

    this.timer = setTimeout(async () => {
      try {
        await this.runDueJobs();
      } catch {
      } finally {
        this.scheduleNext();
      }
    }, delay);
  }

  private async runDueJobs(): Promise<void> {
    const now = Date.now();
    const toRemove: string[] = [];
    const toUpdate: CronJob[] = [];
    const statusUpdates: Array<{ id: string; enabled: boolean; nextRunAtMs?: number }> = [];

    for (const job of this.jobs.values()) {
      if (job.enabled && job.nextRunAtMs && now >= job.nextRunAtMs) {
        const overdueMs = now - job.nextRunAtMs;

        if (overdueMs > MAX_CATCH_UP_DELAY_MS) {

          if (job.schedule.kind === 'once') {
            job.enabled = false;
            job.nextRunAtMs = undefined;
            statusUpdates.push({ id: job.id, enabled: false, nextRunAtMs: undefined });
            continue;
          }

          this.computeNextRun(job);
          toUpdate.push(job);
          continue;
        }

        let executedSuccessfully = true;

        if (this.onJobExecute) {
          try {
            await this.onJobExecute(job);
          } catch {
            executedSuccessfully = false;
          }
        }

        if (!executedSuccessfully) {
          if (job.schedule.kind === 'once') {
            job.enabled = false;
            job.nextRunAtMs = undefined;
            statusUpdates.push({ id: job.id, enabled: false, nextRunAtMs: undefined });
            continue;
          }

          job.nextRunAtMs = now + FAILED_JOB_RETRY_DELAY_MS;
          toUpdate.push(job);
          continue;
        }

        job.lastRunAtMs = now;

        if (job.schedule.kind === 'once') {
          toRemove.push(job.id);
        } else {
          this.computeNextRun(job);
          toUpdate.push(job);
        }
      }
    }

    for (const id of toRemove) {
      this.jobs.delete(id);
      await this.store.delete(id);
    }

    if (toUpdate.length > 0) {
      await this.store.batchUpdate(toUpdate);
    }

    for (const update of statusUpdates) {
      await this.store.updateStatus(update.id, update.enabled, update.nextRunAtMs);
    }
  }

  computeNextRun(job: CronJob): void {
    const now = Date.now();

    switch (job.schedule.kind) {
      case 'once':
        if (job.schedule.onceAt) {
          const atMs = new Date(job.schedule.onceAt).getTime();
          if (Number.isNaN(atMs)) {
            job.nextRunAtMs = undefined;
            break;
          }
          job.nextRunAtMs = atMs > now ? atMs : undefined;
        } else {
          job.nextRunAtMs = undefined;
        }
        break;

      case 'interval':
        job.nextRunAtMs = (job.schedule.intervalMs && job.schedule.intervalMs > 0)
          ? now + job.schedule.intervalMs
          : undefined;
        break;

      case 'daily':
        if (job.schedule.dailyAt) {
          const parts = job.schedule.dailyAt.split(':');
          const hours = parseInt(parts[0]);
          const minutes = parseInt(parts[1]);

          if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
            job.nextRunAtMs = undefined;
            break;
          }

          const today = new Date();
          today.setHours(hours, minutes, 0, 0);
          if (today.getTime() <= now) {
            today.setDate(today.getDate() + 1);
          }
          job.nextRunAtMs = today.getTime();
        } else {
          job.nextRunAtMs = undefined;
        }
        break;

      case 'cron':
        if (job.schedule.cronExpr) {
          try {
            const interval = CronExpressionParser.parse(job.schedule.cronExpr, {
              currentDate: new Date(now),
              tz: job.schedule.tz
            });
            job.nextRunAtMs = interval.next().getTime();
          } catch {
            job.nextRunAtMs = undefined;
          }
        } else {
          job.nextRunAtMs = undefined;
        }
        break;
    }
  }

  private async load(): Promise<void> {
    try {
      const jobs = await this.store.getAll();
      for (const job of jobs) {
        this.jobs.set(job.id, job);
      }
    } catch {
    }
  }
}
