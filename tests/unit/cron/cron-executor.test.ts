import { describe, it, expect, vi } from 'vitest';
import {
  CronExecutor,
  createCronContextSessionKey,
  formatResult,
} from '../../../src/cron/cron-executor';
import { parseSerializedSessionKey } from '../../../src/core/types';
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

describe('parseSerializedSessionKey', () => {
  it('should parse a valid session key JSON', () => {
    const json = JSON.stringify({ channel: 'onebot', type: 'group', chatId: '999' });
    const result = parseSerializedSessionKey(json);
    expect(result).toEqual({ channel: 'onebot', type: 'group', chatId: '999' });
  });

  it('should throw for non-object parsed values', () => {
    expect(() => parseSerializedSessionKey('"string"')).toThrow('无效的 SessionKey');
    expect(() => parseSerializedSessionKey('42')).toThrow('无效的 SessionKey');
    expect(() => parseSerializedSessionKey('null')).toThrow('无效的 SessionKey');
  });

  it('should throw for arrays', () => {
    expect(() => parseSerializedSessionKey('[]')).toThrow('无效的 SessionKey');
  });

  it('should throw when required fields are missing', () => {
    expect(() => parseSerializedSessionKey('{}')).toThrow('无效的 SessionKey');
    expect(() => parseSerializedSessionKey(JSON.stringify({ channel: 'c', type: 't' }))).toThrow(
      '无效的 SessionKey',
    );
  });

  it('should throw for invalid JSON', () => {
    expect(() => parseSerializedSessionKey('not-json')).toThrow();
  });
});

describe('formatResult', () => {
  it('should return a fallback message for empty messages', () => {
    const result = formatResult([]);
    expect(result).toBe('定时任务已完成，但无出站响应。');
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

describe('createCronContextSessionKey', () => {
  it('should build a stable cron-only session key for a job', () => {
    expect(createCronContextSessionKey('job-1')).toEqual({
      channel: 'cron',
      type: 'job',
      chatId: 'job-1',
    });
  });
});

describe('CronExecutor', () => {
  function makeMocks() {
    const cronRuns = {
      create: vi.fn().mockResolvedValue('run-1'),
      markCompleted: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn().mockResolvedValue(undefined),
    };
    const send = vi.fn().mockResolvedValue(undefined);
    const pipeline = {
      receiveWithSend: vi
        .fn()
        .mockImplementation(async (_msg: unknown, send: (m: unknown) => Promise<void>) => {
          await send({ content: 'pipeline response' });
        }),
    };
    const executor = new CronExecutor({ cronRuns, pipeline, send });
    return { executor, cronRuns, pipeline, send };
  }

  describe('execute', () => {
    it('should create a run, execute through pipeline, and mark completed', async () => {
      const { executor, cronRuns, pipeline, send } = makeMocks();
      const job = makeJob();

      await executor.execute(job);

      expect(cronRuns.create).toHaveBeenCalledWith({ jobId: job.id });
      expect(pipeline.receiveWithSend).toHaveBeenCalled();
      const [inbound] = pipeline.receiveWithSend.mock.calls[0] as [Record<string, unknown>];
      expect(inbound.content).toBe('test prompt');
      expect(inbound.sessionKey).toEqual(createCronContextSessionKey('job-1'));
      expect(inbound.rawEvent).toEqual({ cronJobId: 'job-1', cronRunId: 'run-1' });
      expect(send).toHaveBeenCalledWith(
        { channel: 'test', type: 'private', chatId: '123' },
        { content: 'pipeline response' },
      );
      expect(cronRuns.markCompleted).toHaveBeenCalledWith('run-1', 'pipeline response');
    });

    it('should collect multiple outbound messages from the pipeline', async () => {
      const { executor, cronRuns, pipeline, send } = makeMocks();
      pipeline.receiveWithSend.mockImplementation(
        async (_msg: unknown, send: (m: unknown) => Promise<void>) => {
          await send({ content: 'first' });
          await send({ content: 'second' });
        },
      );
      const job = makeJob();

      await executor.execute(job);

      expect(send).toHaveBeenNthCalledWith(
        1,
        { channel: 'test', type: 'private', chatId: '123' },
        { content: 'first' },
      );
      expect(send).toHaveBeenNthCalledWith(
        2,
        { channel: 'test', type: 'private', chatId: '123' },
        { content: 'second' },
      );
      expect(cronRuns.markCompleted).toHaveBeenCalledWith('run-1', 'first\nsecond');
    });

    it('should mark failed and re-throw when outbound delivery fails', async () => {
      const { executor, cronRuns, send } = makeMocks();
      send.mockRejectedValue(new Error('send boom'));
      const job = makeJob();

      await expect(executor.execute(job)).rejects.toThrow('send boom');
      expect(cronRuns.markFailed).toHaveBeenCalledWith('run-1', 'send boom');
      expect(cronRuns.markCompleted).not.toHaveBeenCalled();
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

    it('should mark failed when the persisted target session key is invalid', async () => {
      const { executor, cronRuns, pipeline, send } = makeMocks();
      const job = makeJob({ sessionKey: 'not-json' });

      await expect(executor.execute(job)).rejects.toThrow();

      expect(cronRuns.create).toHaveBeenCalledWith({ jobId: job.id });
      expect(cronRuns.markFailed).toHaveBeenCalledWith('run-1', expect.any(String));
      expect(pipeline.receiveWithSend).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    });
  });
});
