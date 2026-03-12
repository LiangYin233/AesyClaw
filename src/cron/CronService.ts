import { CronExpressionParser } from 'cron-parser';
import { logger, normalizeError } from '../logger/index.js';
import { CronStore } from './CronStore.js';

export interface CronJob {
  id: string;
  name: string;
  enabled: boolean;
  schedule: CronSchedule;
  payload: CronPayload;
  nextRunAtMs?: number;
  lastRunAtMs?: number;
}

export interface CronSchedule {
  kind: 'once' | 'interval' | 'daily' | 'cron';
  onceAt?: string;
  intervalMs?: number;
  dailyAt?: string;
  cronExpr?: string;
  tz?: string;
}

export interface CronPayload {
  description: string;
  detail: string;
  channel?: string;
  target?: string;
}


export class CronService {
  private jobs: Map<string, CronJob> = new Map();
  private timer?: NodeJS.Timeout;
  private store: CronStore;
  private onJobExecute?: (job: CronJob) => Promise<void>;
  private log = logger.child({ prefix: 'Cron' });

  constructor(
    dbPath: string,
    onJobExecute?: (job: CronJob) => Promise<void>
  ) {
    // 数据库路径：将 .json 替换为 .db
    const actualDbPath = dbPath.replace(/\.json$/, '.db');
    this.store = new CronStore(actualDbPath);
    this.onJobExecute = onJobExecute;
  }

  addJob(job: CronJob): CronJob {
    this.computeNextRun(job);
    this.jobs.set(job.id, job);
    this.store.upsert(job).catch(err => this.log.error('Failed to save job:', err));
    this.log.info(`Added job: ${job.name} (${job.id}), next run: ${job.nextRunAtMs ? new Date(job.nextRunAtMs).toISOString() : 'N/A'}`);
    this.wakeUp();
    return job;
  }

  removeJob(id: string): boolean {
    const result = this.jobs.delete(id);
    this.store.delete(id).catch(err => this.log.error('Failed to delete job:', err));
    if (result) this.log.info(`Removed job: ${id}`);
    return result;
  }

  enableJob(id: string, enabled: boolean): void {
    const job = this.jobs.get(id);
    if (job) {
      job.enabled = enabled;
      this.computeNextRun(job);
      this.store.updateStatus(id, enabled, job.nextRunAtMs).catch(err => this.log.error('Failed to update job status:', err));
      this.log.info(`Job ${id} ${enabled ? 'enabled' : 'disabled'}, next run: ${job.nextRunAtMs ? new Date(job.nextRunAtMs).toISOString() : 'N/A'}`);
      this.wakeUp();
    }
  }

  getJob(id: string): CronJob | undefined {
    return this.jobs.get(id);
  }

  listJobs(): CronJob[] {
    return Array.from(this.jobs.values()).map(job => ({
      ...job,
      payload: { ...job.payload, detail: '[隐藏]' }
    }));
  }

  async start(): Promise<void> {
    await this.store.initialize();
    await this.load();
    this.scheduleNext();
    this.log.info(`Service started, ${this.jobs.size} jobs loaded`);
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.store.close().catch(err => this.log.error('Failed to close store:', err));
    this.log.info('Service stopped');
  }

  private wakeUp(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.scheduleNext();
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
      this.log.debug('No jobs scheduled');
      return;
    }

    const delay = Math.max(0, nearest - now);
    this.log.debug(`Next job in ${Math.round(delay / 1000)}s`);

    this.timer = setTimeout(async () => {
      try {
        await this.runDueJobs();
      } catch (error) {
        this.log.error('Error running due jobs:', error);
      } finally {
        this.scheduleNext(); // 确保任务链不中断
      }
    }, delay);
  }

  private async runDueJobs(): Promise<void> {
    const now = Date.now();
    const toRemove: string[] = [];
    const toUpdate: CronJob[] = [];

    for (const job of this.jobs.values()) {
      if (job.enabled && job.nextRunAtMs && now >= job.nextRunAtMs) {
        this.log.info(`Executing job: ${job.name} (${job.id})`);

        if (this.onJobExecute) {
          try {
            await this.onJobExecute(job);
            this.log.info(`Job ${job.id} completed successfully`);
          } catch (error: unknown) {
            this.log.error(`Job ${job.id} failed:`, normalizeError(error));
          }
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
      this.store.delete(id).catch(err => this.log.error('Failed to delete job:', err));
      this.log.info(`One-time job ${id} completed and removed`);
    }

    if (toUpdate.length > 0) {
      this.store.batchUpdate(toUpdate).catch(err => this.log.error('Failed to update jobs:', err));
    }
  }

  computeNextRun(job: CronJob): void {
    const now = Date.now();

    switch (job.schedule.kind) {
      case 'once':
        if (job.schedule.onceAt) {
          const atMs = new Date(job.schedule.onceAt).getTime();
          if (Number.isNaN(atMs)) {
            this.log.warn(`Invalid onceAt time: ${job.schedule.onceAt}`);
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
            this.log.warn(`Invalid dailyAt time: ${job.schedule.dailyAt}`);
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
            this.log.warn(`Invalid cron expression: ${job.schedule.cronExpr}`);
            job.nextRunAtMs = undefined;
          }
        } else {
          job.nextRunAtMs = undefined;
        }
        break;
    }
  }

  /**
   * 从数据库加载任务
   */
  private async load(): Promise<void> {
    try {
      const jobs = await this.store.getAll();
      for (const job of jobs) {
        this.jobs.set(job.id, job);
      }
    } catch (error) {
      this.log.error('Failed to load jobs:', error);
    }
  }
}
