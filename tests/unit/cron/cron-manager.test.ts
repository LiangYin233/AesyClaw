import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CronJobRecord, Message, SessionKey } from '../../../src/core/types';
import type {
  CronJobsRepository,
  CronRunsRepository,
} from '../../../src/core/database/database-manager';
import type { SessionManager } from '../../../src/session';
import type { HookRegistration } from '../../../src/hook/types';
import { CoreLifecycle, type CoreLifecycleDependencies } from '../../../src/core/core-lifecycle';
import { CronManager } from '../../../src/cron/cron-manager';
import { computeNextRun, CronScheduler } from '../../../src/cron/cron-scheduler';
import {
  createCreateCronTool,
  createDeleteCronTool,
  createListCronTool,
} from '../../../src/tool/builtin/cron-tools';

class FakeCronJobRepo implements CronJobsRepository {
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

  async updateNextRun(id: string, nextRun: Date | null): Promise<boolean> {
    this.updateNextRunCalls.push({ id, nextRun });
    const job = this.jobs.get(id);
    if (!job) return false;
    job.nextRun = nextRun?.toISOString() ?? null;
    return true;
  }
}

class FakeCronRunRepo implements CronRunsRepository {
  created: string[] = [];
  completed: Array<{ runId: string; result: string }> = [];
  failed: Array<{ runId: string; error: string }> = [];
  abandoned: string[] = [];
  abandonError: Error | null = null;

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
    if (this.abandonError) {
      throw this.abandonError;
    }
    this.abandoned.push(...runIds);
  }
}

function makeHooksBus() {
  return {
    register: vi.fn((_reg: unknown) => undefined),
    unregister: vi.fn((_id: string) => undefined),
    unregisterByPrefix: vi.fn(() => undefined),
    enable: vi.fn(() => undefined),
    disable: vi.fn(() => undefined),
    isEnabled: vi.fn(() => false),
    dispatch: vi.fn(async () => ({ action: 'next' as const })),
    clear: vi.fn(() => undefined),
  };
}

function makePipeline(response = 'done', hooksBus = makeHooksBus()) {
  return {
    hooksBus,
    receiveWithSend: vi.fn(async (_message, _sessionKey, _sender, send) => {
      await send({ components: [{ type: 'Plain', text: response }] });
    }),
  } as unknown as ConstructorParameters<typeof CronManager>[0]['pipeline'];
}

function makeSend() {
  return vi.fn(async () => undefined);
}

function makeSessionManager(existingSession?: { clear: () => Promise<void> }): SessionManager {
  return {
    get: vi.fn((_sessionKey: SessionKey) => existingSession ?? null),
    create: vi.fn().mockResolvedValue({ add: vi.fn().mockResolvedValue(undefined) }),
  } as unknown as SessionManager;
}

function makeInitializeDeps(params: {
  jobs: CronJobsRepository;
  runs: CronRunsRepository;
  pipeline?: ReturnType<typeof makePipeline>;
  send?: (sessionKey: SessionKey, message: Message) => Promise<void>;
  sessionManager?: SessionManager;
  scheduler?: CronScheduler;
}): ConstructorParameters<typeof CronManager>[0] {
  return {
    databaseManager: { cronJobs: params.jobs, cronRuns: params.runs },
    pipeline: params.pipeline ?? makePipeline(),
    sessionManager: params.sessionManager ?? makeSessionManager(),
    send: params.send ?? makeSend(),
    scheduler: params.scheduler,
  };
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
    const manager = new CronManager(
      makeInitializeDeps({
        jobs,
        runs,
        pipeline,
        send,
      }),
    );
    await manager.initialize();

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
        components: [{ type: 'Plain', text: 'check status' }],
      }),
      { channel: 'cron', type: 'job', chatId: jobId },
      undefined,
      expect.any(Function),
    );
    expect(send).toHaveBeenCalledWith(
      { channel: 'test', type: 'private', chatId: '1' },
      { components: [{ type: 'Plain', text: 'cron response' }] },
    );

    expect(await manager.deleteJob(jobId)).toBe(true);
    await manager.destroy();
  });

  it('lists all cron jobs when no filter is provided and filters by session key when requested', async () => {
    const jobs = new FakeCronJobRepo();
    const runs = new FakeCronRunRepo();
    const manager = new CronManager(makeInitializeDeps({ jobs, runs }));
    await manager.initialize();

    await manager.createJob({
      scheduleType: 'interval',
      scheduleValue: '30m',
      prompt: 'chat 1',
      sessionKey: { channel: 'test', type: 'private', chatId: '1' },
    });
    await manager.createJob({
      scheduleType: 'interval',
      scheduleValue: '30m',
      prompt: 'chat 2',
      sessionKey: { channel: 'test', type: 'private', chatId: '2' },
    });

    expect(await manager.listJobs()).toHaveLength(2);
    await expect(
      manager.listJobs({ sessionKey: { channel: 'test', type: 'private', chatId: '1' } }),
    ).resolves.toEqual([expect.objectContaining({ prompt: 'chat 1' })]);

    await manager.destroy();
  });

  it('registers an internal hook that clears existing cron job sessions on receive', async () => {
    const jobs = new FakeCronJobRepo();
    const runs = new FakeCronRunRepo();
    const hooks = makeHooksBus();
    const clear = vi.fn(async () => undefined);
    const sessionManager = makeSessionManager({ clear });
    const manager = new CronManager(
      makeInitializeDeps({
        jobs,
        runs,
        pipeline: makePipeline('done', hooks),
        sessionManager,
      }),
    );

    await manager.initialize();

    expect(hooks.register).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'internal:cron', chain: 'pipeline:receive' }),
    );
    const reg = hooks.register.mock.calls[0]?.[0];

    await expect(
      reg?.handler?.(
        {
          message: { components: [{ type: 'Plain', text: 'run' }] },
          sessionKey: { channel: 'cron', type: 'job', chatId: 'job-1' },
        },
        async () => ({ action: 'next' as const }),
      ),
    ).resolves.toEqual({ action: 'next' });
    expect(sessionManager.get).toHaveBeenCalledWith({
      channel: 'cron',
      type: 'job',
      chatId: 'job-1',
    });
    expect(clear).toHaveBeenCalledTimes(1);

    await manager.destroy();
  });

  it('unregisters the internal cron hook on destroy', async () => {
    const jobs = new FakeCronJobRepo();
    const runs = new FakeCronRunRepo();
    const hooks = makeHooksBus();
    const manager = new CronManager(
      makeInitializeDeps({
        jobs,
        runs,
        pipeline: makePipeline('done', hooks),
      }),
    );
    await manager.initialize();
    await manager.destroy();

    expect(hooks.unregister).toHaveBeenCalledWith('internal:cron');
  });

  it('unregisters the internal cron hook when destroy follows failed initialization', async () => {
    const jobs = new FakeCronJobRepo();
    const runs = new FakeCronRunRepo();
    runs.abandonError = new Error('abandon failed');
    const hooks = makeHooksBus();
    const manager = new CronManager(
      makeInitializeDeps({
        jobs,
        runs,
        pipeline: makePipeline('done', hooks),
      }),
    );

    await expect(manager.initialize()).rejects.toThrow('abandon failed');

    await expect(manager.destroy()).resolves.toBeUndefined();
    expect(hooks.unregister).toHaveBeenCalledWith('internal:cron');
  });

  it('marks runs failed when pipeline execution fails', async () => {
    const jobs = new FakeCronJobRepo();
    const runs = new FakeCronRunRepo();
    const manager = new CronManager(
      makeInitializeDeps({
        jobs,
        runs,
        pipeline: {
          hooksBus: makeHooksBus(),
          receiveWithSend: vi.fn(async () => {
            throw new Error('pipeline boom');
          }),
        } as unknown as ConstructorParameters<typeof CronManager>[0]['pipeline'],
      }),
    );
    await manager.initialize();
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
    const manager = new CronManager(
      makeInitializeDeps({
        jobs,
        runs,
        pipeline,
        scheduler,
      }),
    );
    await manager.initialize();

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
    const manager = new CronManager(
      makeInitializeDeps({
        jobs,
        runs,
        pipeline,
        scheduler,
      }),
    );
    await manager.initialize();

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

  it('advances overdue interval jobs during schedule reload without executing them', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-26T10:00:00Z'));

    const jobs = new FakeCronJobRepo();
    jobs.jobs.set('job-1', {
      id: 'job-1',
      scheduleType: 'interval',
      scheduleValue: '30m',
      prompt: 'check status',
      sessionKey: JSON.stringify({ channel: 'test', type: 'private', chatId: '1' }),
      nextRun: '2026-04-26T09:00:00.000Z',
      createdAt: new Date().toISOString(),
    });
    const runs = new FakeCronRunRepo();
    const scheduler = new CronScheduler();
    const manager = new CronManager(
      makeInitializeDeps({
        jobs,
        runs,
        pipeline: makePipeline('cron response'),
        scheduler,
      }),
    );

    await manager.initialize();

    expect(runs.created).toEqual([]);
    expect(runs.completed).toEqual([]);
    expect(jobs.updateNextRunCalls).toEqual([
      { id: 'job-1', nextRun: new Date('2026-04-26T10:30:00.000Z') },
    ]);
    expect(jobs.jobs.get('job-1')?.nextRun).toBe('2026-04-26T10:30:00.000Z');
    expect(scheduler.count()).toBe(1);

    await manager.destroy();
  });

  it('advances overdue daily jobs during schedule reload without executing them', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-04-26T10:00:00');
    vi.setSystemTime(now);

    const jobs = new FakeCronJobRepo();
    jobs.jobs.set('job-1', {
      id: 'job-1',
      scheduleType: 'daily',
      scheduleValue: '09:30',
      prompt: 'daily report',
      sessionKey: JSON.stringify({ channel: 'test', type: 'private', chatId: '1' }),
      nextRun: new Date('2026-04-26T09:30:00').toISOString(),
      createdAt: new Date().toISOString(),
    });
    const runs = new FakeCronRunRepo();
    const scheduler = new CronScheduler();
    const manager = new CronManager(
      makeInitializeDeps({
        jobs,
        runs,
        pipeline: makePipeline('cron response'),
        scheduler,
      }),
    );

    await manager.initialize();

    const persistedNextRun = jobs.jobs.get('job-1')?.nextRun;
    expect(runs.created).toEqual([]);
    expect(jobs.updateNextRunCalls).toHaveLength(1);
    expect(jobs.updateNextRunCalls[0]?.id).toBe('job-1');
    expect(jobs.updateNextRunCalls[0]?.nextRun?.getTime()).toBeGreaterThan(now.getTime());
    expect(persistedNextRun).toBe(jobs.updateNextRunCalls[0]?.nextRun?.toISOString());
    expect(scheduler.count()).toBe(1);

    await manager.destroy();
  });

  it('clears overdue once jobs during schedule reload without executing or scheduling them', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-26T10:00:00Z'));

    const jobs = new FakeCronJobRepo();
    jobs.jobs.set('job-1', {
      id: 'job-1',
      scheduleType: 'once',
      scheduleValue: '2026-04-26T09:00:00.000Z',
      prompt: 'one shot',
      sessionKey: JSON.stringify({ channel: 'test', type: 'private', chatId: '1' }),
      nextRun: '2026-04-26T09:00:00.000Z',
      createdAt: new Date().toISOString(),
    });
    const runs = new FakeCronRunRepo();
    const scheduler = new CronScheduler();
    const manager = new CronManager(
      makeInitializeDeps({
        jobs,
        runs,
        pipeline: makePipeline('cron response'),
        scheduler,
      }),
    );

    await manager.initialize();

    expect(runs.created).toEqual([]);
    expect(jobs.updateNextRunCalls).toEqual([{ id: 'job-1', nextRun: null }]);
    expect(jobs.jobs.get('job-1')?.nextRun).toBeNull();
    expect(scheduler.count()).toBe(0);

    await manager.destroy();
  });

  it('keeps future jobs scheduled at their persisted nextRun during schedule reload', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-26T10:00:00Z'));

    const jobs = new FakeCronJobRepo();
    jobs.jobs.set('job-1', {
      id: 'job-1',
      scheduleType: 'interval',
      scheduleValue: '30m',
      prompt: 'check status',
      sessionKey: JSON.stringify({ channel: 'test', type: 'private', chatId: '1' }),
      nextRun: '2026-04-26T10:15:00.000Z',
      createdAt: new Date().toISOString(),
    });
    const runs = new FakeCronRunRepo();
    const scheduler = new CronScheduler();
    const manager = new CronManager(
      makeInitializeDeps({
        jobs,
        runs,
        pipeline: makePipeline('cron response'),
        scheduler,
      }),
    );

    await manager.initialize();

    expect(runs.created).toEqual([]);
    expect(jobs.updateNextRunCalls).toEqual([]);
    expect(jobs.jobs.get('job-1')?.nextRun).toBe('2026-04-26T10:15:00.000Z');
    expect(scheduler.count()).toBe(1);

    await manager.destroy();
  });

  it('reschedules interval jobs after timer-driven runs complete', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-26T10:00:00Z'));

    const jobs = new FakeCronJobRepo();
    const runs = new FakeCronRunRepo();
    const pipeline = makePipeline('cron response');
    const scheduler = new CronScheduler();
    const manager = new CronManager(
      makeInitializeDeps({
        jobs,
        runs,
        pipeline,
        scheduler,
      }),
    );
    await manager.initialize();

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
    const manager = new CronManager(
      makeInitializeDeps({
        jobs,
        runs,
        pipeline: {
          hooksBus: makeHooksBus(),
          receiveWithSend: vi.fn(async () => {
            throw new Error('pipeline boom');
          }),
        } as unknown as ConstructorParameters<typeof CronManager>[0]['pipeline'],
        scheduler,
      }),
    );
    await manager.initialize();

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

  it('does not reschedule a timer-driven job deleted while running', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-26T10:00:00Z'));

    const jobs = new FakeCronJobRepo();
    const runs = new FakeCronRunRepo();
    let unblockPipeline: (() => void) | undefined;
    const pipeline = {
      hooksBus: makeHooksBus(),
      receiveWithSend: vi.fn(async (_message, _sessionKey, _sender, send) => {
        await new Promise<void>((resolve) => {
          unblockPipeline = resolve;
        });
        await send({ components: [{ type: 'Plain', text: 'cron response' }] });
      }),
    };
    const scheduler = new CronScheduler();
    const manager = new CronManager(
      makeInitializeDeps({
        jobs,
        runs,
        pipeline,
        scheduler,
      }),
    );
    await manager.initialize();

    const jobId = await manager.createJob({
      scheduleType: 'interval',
      scheduleValue: '1m',
      prompt: 'check status',
      sessionKey: { channel: 'test', type: 'private', chatId: '1' },
    });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(pipeline.receiveWithSend).toHaveBeenCalledTimes(1);

    expect(await manager.deleteJob(jobId)).toBe(true);
    unblockPipeline?.();
    await vi.runOnlyPendingTimersAsync();

    expect(runs.completed).toEqual([{ runId: 'run-1', result: 'cron response' }]);
    expect(jobs.updateNextRunCalls).toHaveLength(1);
    expect(scheduler.count()).toBe(0);

    await manager.destroy();
  });

  it('cron tools call CronManager with the current session filter for list_cron', async () => {
    const cronManager = {
      createJob: vi.fn(async () => 'job-1'),
      listJobs: vi.fn(async (filter?: { sessionKey?: SessionKey }) => {
        const allJobs = [
          {
            id: 'job-1',
            scheduleType: 'interval',
            scheduleValue: '30m',
            prompt: 'ping',
            sessionKey: JSON.stringify({ channel: 'test', type: 'private', chatId: '1' }),
            nextRun: null,
            createdAt: '',
          },
          {
            id: 'job-2',
            scheduleType: 'interval',
            scheduleValue: '30m',
            prompt: 'other chat',
            sessionKey: JSON.stringify({ channel: 'test', type: 'private', chatId: '2' }),
            nextRun: null,
            createdAt: '',
          },
        ];
        return allJobs.filter(
          (job) => JSON.parse(job.sessionKey).chatId === filter?.sessionKey?.chatId,
        );
      }),
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
    ).resolves.toEqual({ content: '定时任务已创建: job-1' });
    await expect(createListCronTool({ cronManager }).execute({}, context)).resolves.toEqual({
      content: expect.stringContaining('job-1'),
    });
    expect(cronManager.listJobs).toHaveBeenCalledWith({
      sessionKey: { channel: 'test', type: 'private', chatId: '1' },
    });
    await expect(createListCronTool({ cronManager }).execute({}, context)).resolves.toEqual({
      content: expect.not.stringContaining('job-2'),
    });
    await expect(
      createDeleteCronTool({ cronManager }).execute({ jobId: 'job-1' }, context),
    ).resolves.toEqual({ content: '定时任务已删除: job-1' });
  });
});

describe('CoreLifecycle shutdown', () => {
  it('destroys cron before extension and MCP teardown', async () => {
    const order: string[] = [];
    const lifecycle = new CoreLifecycle({
      configManager: { stopHotReload: () => order.push('config') },
      roleManager: { destroy: () => order.push('role') },
      mcpManager: {
        disconnectAll: async () => {
          order.push('mcp');
        },
      },
      pipeline: { destroy: () => order.push('pipeline') },
      databaseManager: { destroy: () => order.push('database') },
    } as unknown as CoreLifecycleDependencies);
    Object.defineProperty(lifecycle, 'extensionManager', {
      value: {
        destroy: async () => {
          order.push('extension');
        },
      },
      writable: true,
    });
    Object.defineProperty(lifecycle, 'cronManager', {
      value: {
        destroy: async () => {
          order.push('cron');
        },
      },
      writable: true,
    });
    Object.defineProperty(lifecycle, 'webUiManager', {
      value: {
        destroy: () => order.push('web'),
      },
      writable: true,
    });

    await lifecycle.stop();

    expect(order).toEqual([
      'config',
      'web',
      'cron',
      'role',
      'extension',
      'mcp',
      'pipeline',
      'database',
    ]);
  });
});
