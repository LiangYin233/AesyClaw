import { describe, it, expect, vi } from 'vitest';
import {
  CronExecutor,
  parseSessionKey,
  formatResult,
} from '../../../src/cron/cron-executor';
import type { CronJobRecord } from '../../../src/core/types';

function makeJob(overrides: Partial<CronJobRecord> = {}): CronJobRecord {
  return {
    id: 'job-1',
    scheduleType: 'once',
    scheduleValue: new Date(Date.now() + 10000).toISOString(),
    prompt: 'test prompt',
    sessionKey: JSON.stringify({ channel: 'test', type: 'private', chatId: '123' }),
    nextRun: new Date(Date.now() + 10000).toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('parseSessionKey', () => {
  it('should parse a valid session key JSON', () => {
    const json = JSON.stringify({ channel: 'onebot', type: 'group', chatId: '999' });
    const result = parseSessionKey(json);
    expect(result).toEqual({ channel: 'onebot', type: 'group', chatId: '999' });
  });

  it('should throw for non-object parsed values', () => {
    expect(() => parseSessionKey('"string"')).toThrow('Invalid cron session key');
    expect(() => parseSessionKey('42')).toThrow('Invalid cron session key');
    expect(() => parseSessionKey('null')).toThrow('Invalid cron session key');
  });

  it('should throw for arrays', () => {
    expect(() => parseSessionKey('[]')).toThrow('Invalid cron session key');
  });

  it('should throw when required fields are missing', () => {
    expect(() => parseSessionKey('{}')).toThrow('Invalid cron session key');
    expect(() => parseSessionKey(JSON.stringify({ channel: 'c', type: 't' }))).toThrow(
      'Invalid cron session key',
    );
  });

  it('should throw for invalid JSON', () => {
    expect(() => parseSessionKey('not-json')).toThrow();
  });
});

describe('formatResult', () => {
  it('should return a fallback message for empty messages', () => {
    const result = formatResult([]);
    expect(result).toBe('Cron job completed without outbound response.');
  });

  it('should join multiple messages with newlines', () => {
    const result = formatResult([{ content: 'a' }, { content: 'b' }, { content: 'c' }]);
    expect(result).toBe('a\nb\nc');
  });

  it('should handle a single message', () => {
    const result = formatResult([{ content: 'hello' }]);
    expect(result).toBe('hello');
  });
});

describe('CronExecutor', () => {
  function makeMocks() {
    const cronRuns = {
      create: vi.fn().mockResolvedValue('run-1'),
      markCompleted: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn().mockResolvedValue(undefined),
    };
    const pipeline = {
      receiveWithSend: vi.fn().mockImplementation(
        async (_msg: unknown, send: (m: unknown) => Promise<void>) => {
          await send({ content: 'pipeline response' });
        },
      ),
    };
    const executor = new CronExecutor({ cronRuns, pipeline });
    return { executor, cronRuns, pipeline };
  }

  describe('execute', () => {
    it('should create a run, execute through pipeline, and mark completed', async () => {
      const { executor, cronRuns, pipeline } = makeMocks();
      const job = makeJob();

      await executor.execute(job);

      expect(cronRuns.create).toHaveBeenCalledWith({ jobId: job.id });
      expect(pipeline.receiveWithSend).toHaveBeenCalled();
      const [inbound] = pipeline.receiveWithSend.mock.calls[0] as [Record<string, unknown>];
      expect(inbound.content).toBe('test prompt');
      expect(inbound.rawEvent).toEqual({ cronJobId: 'job-1', cronRunId: 'run-1' });
      expect(cronRuns.markCompleted).toHaveBeenCalledWith('run-1', 'pipeline response');
    });

    it('should collect multiple outbound messages from the pipeline', async () => {
      const { executor, cronRuns, pipeline } = makeMocks();
      pipeline.receiveWithSend.mockImplementation(
        async (_msg: unknown, send: (m: unknown) => Promise<void>) => {
          await send({ content: 'first' });
          await send({ content: 'second' });
        },
      );
      const job = makeJob();

      await executor.execute(job);

      expect(cronRuns.markCompleted).toHaveBeenCalledWith('run-1', 'first\nsecond');
    });

    it('should mark failed and re-throw on pipeline error', async () => {
      const { executor, cronRuns, pipeline } = makeMocks();
      pipeline.receiveWithSend.mockRejectedValue(new Error('pipeline boom'));
      const job = makeJob();

      await expect(executor.execute(job)).rejects.toThrow('pipeline boom');
      expect(cronRuns.markFailed).toHaveBeenCalledWith('run-1', 'pipeline boom');
      expect(cronRuns.markCompleted).not.toHaveBeenCalled();
    });

    it('should handle non-Error pipeline failures', async () => {
      const { executor, cronRuns, pipeline } = makeMocks();
      pipeline.receiveWithSend.mockRejectedValue('raw error');
      const job = makeJob();

      await expect(executor.execute(job)).rejects.toBe('raw error');
      expect(cronRuns.markFailed).toHaveBeenCalledWith('run-1', 'raw error');
    });
  });
});

