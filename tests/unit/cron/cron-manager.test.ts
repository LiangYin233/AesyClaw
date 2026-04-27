import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CronJobRecord, SessionKey } from '../../../src/core/types';
import { CronManager, type CronJobRepositoryLike } from '../../../src/cron/cron-manager';
import type { CronRunRepositoryLike } from '../../../src/cron/cron-executor';
import { computeNextRun, CronScheduler } from '../../../src/cron/cron-scheduler';
import {
  createCreateCronTool,
  createDeleteCronTool,
  createListCronTool,
} from '../../../src/tool/builtin/cron-tools';

class FakeCronJobRepo implements CronJobRepositoryLike {
  jobs = new Map<string, CronJobRecord>();
  nextId = 1;
  deleteError: Error | null = null;
  updateNextRunCalls: Array<{ id: string; nextRun: Date | null }> = [];

  async create(params: {
    scheduleType: string;
    scheduleValue: string;
    prompt: string;
    sessionKey: SessionKey;
    nextRun: Date | null;
  }): Promise<string> {
    const id = `job-${this.nextId++}`;
    this.jobs.set(id, {
      id,
      scheduleType: params.scheduleType,
      scheduleValue: params.scheduleValue,
      prompt: params.prompt,
      sessionKey: JSON.stringify(params.sessionKey),
      nextRun: params.nextRun?.toISOString() ?? null,
      createdAt: new Date().toISOString(),
    });
    return id;
  }

  async findById(id: string): Promise<CronJobRecord | null> {
    return this.jobs.get(id) ?? null;
  }

  async findAll(): Promise<CronJobRecord[]> {
    return [...this.jobs.values()];
  }

  async delete(id: string): Promise<boolean> {
    if (this.deleteError) {
      throw this.deleteError;
    }
    return this.jobs.delete(id);
  }

  async updateNextRun(id: string, nextRun: Date | null): Promise<void> {
    this.updateNextRunCalls.push({ id, nextRun });
    const job = this.jobs.get(id);
    if (job) job.nextRun = nextRun?.toISOString() ?? null;
  }
}

class FakeCronRunRepo implements CronRunRepositoryLike {
  created: string[] = [];
  completed: Array<{ runId: string; result: string }> = [];
  failed: Array<{ runId: string; error: string }> = [];
  abandoned: string[] = [];

  async create(): Promise<string> {
    const id = `run-${this.created.length + 1}`;
    this.created.push(id);
    return id;
  }

  async markCompleted(runId: string, result: string): Promise<void> {
    this.completed.push({ runId, result });
  }

  async markFailed(runId: string, error: string): Promise<void> {
    this.failed.push({ runId, error });
  }

  async findRunning(): Promise<Array<{ id: string }>> {
    return [{ id: 'leftover' }];
  }

  async markAbandoned(runIds: string[]): Promise<void> {
    this.abandoned.push(...runIds);
  }
}

function makePipeline(response = 'done') {
  return {
    receiveWithSend: vi.fn(async (_message, send) => {
      await send({ content: response });
    }),
  };
}

function makeSend() {
  return vi.fn(async () => undefined);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Cron', () => {
  it('computes next run times for supported schedule types', () => {
    const from = new Date('2026-04-24T10:00:00Z');
    expect(computeNextRun('once', '2026-04-24T11:00:00Z', from)?.toISOString()).toBe(
      '2026-04-24T11:00:00.000Z',
    );
    expect(computeNextRun('once', '2026-04-24T09:00:00Z', from)).toBeNull();
    expect(computeNextRun('interval', '30m', from)?.toISOString()).toBe('2026-04-24T10:30:00.000Z');
    expect(computeNextRun('daily', '09:30', new Date('2026-04-24T10:00:00'))).not.toBeNull();
  });

  it('does not schedule jobs with invalid nextRun values', () => {
    const scheduler = new CronScheduler();
    const callback = vi.fn();

    scheduler.schedule(
      {
        id: 'bad-next-run',
        scheduleType: 'once',
        scheduleValue: 'not-a-date',
        prompt: 'bad',
        sessionKey: '{}',
        nextRun: 'not-a-date',
        createdAt: new Date().toISOString(),
      },
      callback,
    );

    expect(scheduler.count()).toBe(0);
    expect(callback).not.toHaveBeenCalled();
  });

  it('creates, lists, runs, and deletes cron jobs', async () => {
    const jobs = new FakeCronJobRepo();
    const runs = new FakeCronRunRepo();
    const pipeline = makePipeline('cron response');
    const send = makeSend();
    const manager = new CronManager();
    await manager.initialize({ cronJobs: jobs, cronRuns: runs, pipeline, send });

    const jobId = await manager.createJob({
      scheduleType: 'interval',
      scheduleValue: '30m',
      prompt: 'check status',
      sessionKey: { channel: 'test', type: 'private', chatId: '1' },
    });

    expect(runs.abandoned).toEqual(['leftover']);
    expect(await manager.listJobs()).toHaveLength(1);

    const result = await manager.runJobNow(jobId);
    expect(result).toBe('cron response');
    expect(runs.completed).toEqual([{ runId: 'run-1', result: 'cron response' }]);
    expect(pipeline.receiveWithSend).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'check status',
        sessionKey: { channel: 'cron', type: 'job', chatId: jobId },
      }),
      expect.any(Function),
    );
    expect(send).toHaveBeenCalledWith(
      { channel: 'test', type: 'private', chatId: '1' },
      { content: 'cron response' },
    );

    expect(await manager.deleteJob(jobId)).toBe(true);
    await manager.destroy();
  });

  it('marks runs failed when pipeline execution fails', async () => {
    const jobs = new FakeCronJobRepo();
    const runs = new FakeCronRunRepo();
    const manager = new CronManager();
    await manager.initialize({
      cronJobs: jobs,
      cronRuns: runs,
      send: makeSend(),
      pipeline: {
        receiveWithSend: vi.fn(async () => {
          throw new Error('pipeline boom');
        }),
      },
    });
    const jobId = await manager.createJob({
      scheduleType: 'interval',
      scheduleValue: '30m',
      prompt: 'fail',
      sessionKey: { channel: 'test', type: 'private', chatId: '1' },
    });

    await expect(manager.runJobNow(jobId)).rejects.toThrow('pipeline boom');
    expect(runs.failed).toEqual([{ runId: 'run-1', error: 'pipeline boom' }]);
    await manager.destroy();
  });

  it('does not cancel the scheduled timer if deleting the job fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-26T10:00:00Z'));

    const jobs = new FakeCronJobRepo();
    const runs = new FakeCronRunRepo();
    const pipeline = makePipeline('cron response');
    const scheduler = new CronScheduler();
    const manager = new CronManager();
    await manager.initialize({
      cronJobs: jobs,
      cronRuns: runs,
      pipeline,
      send: makeSend(),
      scheduler,
    });

    const jobId = await manager.createJob({
      scheduleType: 'interval',
      scheduleValue: '30m',
      prompt: 'check status',
      sessionKey: { channel: 'test', type: 'private', chatId: '1' },
    });

    expect(scheduler.count()).toBe(1);

    jobs.deleteError = new Error('delete failed');

    await expect(manager.deleteJob(jobId)).rejects.toThrow('delete failed');
    expect(scheduler.count()).toBe(1);

    await manager.destroy();
  });

  it('runs jobs manually without mutating nextRun or replacing the scheduled timer', async () => {
    const jobs = new FakeCronJobRepo();
    const runs = new FakeCronRunRepo();
    const pipeline = makePipeline('cron response');
    const schedule = vi.fn();
    const cancel = vi.fn();
    const scheduler = {
      schedule,
      cancel,
      clearAll: vi.fn(),
      count: vi.fn(() => 0),
    } as unknown as CronScheduler;
    const manager = new CronManager();
    await manager.initialize({
      cronJobs: jobs,
      cronRuns: runs,
      pipeline,
      send: makeSend(),
      scheduler,
    });

    const jobId = await manager.createJob({
      scheduleType: 'interval',
      scheduleValue: '30m',
      prompt: 'check status',
      sessionKey: { channel: 'test', type: 'private', chatId: '1' },
    });

    const originalNextRun = jobs.jobs.get(jobId)?.nextRun;
    expect(originalNextRun).toBeTruthy();
    expect(schedule).toHaveBeenCalledTimes(1);

    const result = await manager.runJobNow(jobId);

    expect(result).toBe('cron response');
    expect(jobs.jobs.get(jobId)?.nextRun).toBe(originalNextRun);
    expect(jobs.updateNextRunCalls).toEqual([]);
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();

    await manager.destroy();
  });

  it('reschedules interval jobs after timer-driven runs complete', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-26T10:00:00Z'));

    const jobs = new FakeCronJobRepo();
    const runs = new FakeCronRunRepo();
    const pipeline = makePipeline('cron response');
    const scheduler = new CronScheduler();
    const manager = new CronManager();
    await manager.initialize({
      cronJobs: jobs,
      cronRuns: runs,
      pipeline,
      send: makeSend(),
      scheduler,
    });

    const jobId = await manager.createJob({
      scheduleType: 'interval',
      scheduleValue: '1m',
      prompt: 'check status',
      sessionKey: { channel: 'test', type: 'private', chatId: '1' },
    });

    const originalNextRun = jobs.jobs.get(jobId)?.nextRun;

    await vi.advanceTimersByTimeAsync(60_000);

    expect(runs.completed).toEqual([{ runId: 'run-1', result: 'cron response' }]);
    expect(jobs.updateNextRunCalls).toHaveLength(1);
    expect(jobs.jobs.get(jobId)?.nextRun).not.toBe(originalNextRun);
    expect(scheduler.count()).toBe(1);

    await manager.destroy();
  });

  it('reschedules interval jobs after timer-driven runs fail', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-26T10:00:00Z'));

    const jobs = new FakeCronJobRepo();
    const runs = new FakeCronRunRepo();
    const scheduler = new CronScheduler();
    const manager = new CronManager();
    await manager.initialize({
      cronJobs: jobs,
      cronRuns: runs,
      send: makeSend(),
      pipeline: {
        receiveWithSend: vi.fn(async () => {
          throw new Error('pipeline boom');
        }),
      },
      scheduler,
    });

    await manager.createJob({
      scheduleType: 'interval',
      scheduleValue: '1m',
      prompt: 'check status',
      sessionKey: { channel: 'test', type: 'private', chatId: '1' },
    });

    await vi.advanceTimersByTimeAsync(60_000);

    expect(runs.failed).toEqual([{ runId: 'run-1', error: 'pipeline boom' }]);
    expect(jobs.updateNextRunCalls).toHaveLength(1);
    expect(scheduler.count()).toBe(1);

    await manager.destroy();
  });

  it('cron tools call CronManager', async () => {
    const cronManager = {
      createJob: vi.fn(async () => 'job-1'),
      listJobs: vi.fn(async () => [
        {
          id: 'job-1',
          scheduleType: 'interval',
          scheduleValue: '30m',
          prompt: 'ping',
          sessionKey: '{}',
          nextRun: null,
          createdAt: '',
        },
      ]),
      deleteJob: vi.fn(async () => true),
    };
    const context = {
      sessionKey: { channel: 'test', type: 'private', chatId: '1' },
      agentEngine: null,
      cronManager: null,
      pipeline: null,
    };

    await expect(
      createCreateCronTool({ cronManager }).execute(
        { scheduleType: 'interval', scheduleValue: '30m', prompt: 'ping' },
        context,
      ),
    ).resolves.toEqual({ content: 'Cron job created: job-1' });
    await expect(createListCronTool({ cronManager }).execute({}, context)).resolves.toEqual({
      content: expect.stringContaining('job-1'),
    });
    await expect(
      createDeleteCronTool({ cronManager }).execute({ jobId: 'job-1' }, context),
    ).resolves.toEqual({ content: 'Cron job deleted: job-1' });
  });
});
