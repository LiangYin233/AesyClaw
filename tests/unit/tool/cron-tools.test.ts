import { describe, expect, it, vi } from 'vitest';
import { createCreateCronTool, createDeleteCronTool, createListCronTool } from '../../../src/tool/builtin/cron-tools';

const SESSION_KEY = { channel: 'desktop' as const, type: 'private' as const, chatId: 'test' };
const CTX = { sessionKey: SESSION_KEY } as never;

describe('createCreateCronTool', () => {
  it('creates a cron job and returns its id', async () => {
    const createJob = vi.fn(async () => 'job-123');
    const tool = createCreateCronTool({ cronManager: { createJob, listJobs: vi.fn(), deleteJob: vi.fn() } });
    const result = await tool.execute(
      { scheduleType: 'once', scheduleValue: '2025-12-31T23:59:00Z', prompt: 'Do something' },
      CTX,
    );
    expect(result.content).toContain('job-123');
  });

  it('returns error on failure', async () => {
    const createJob = vi.fn(async () => { throw new Error('Invalid schedule'); });
    const tool = createCreateCronTool({ cronManager: { createJob, listJobs: vi.fn(), deleteJob: vi.fn() } });
    const result = await tool.execute(
      { scheduleType: 'invalid', scheduleValue: '', prompt: '' },
      CTX,
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Invalid schedule');
  });
});

describe('createDeleteCronTool', () => {
  it('deletes a cron job', async () => {
    const deleteJob = vi.fn(async () => true);
    const tool = createDeleteCronTool({ cronManager: { createJob: vi.fn(), listJobs: vi.fn(), deleteJob } });
    const result = await tool.execute({ jobId: 'job-123' }, CTX);
    expect(result.content).toContain('已删除');
  });

  it('handles non-existent job', async () => {
    const deleteJob = vi.fn(async () => false);
    const tool = createDeleteCronTool({ cronManager: { createJob: vi.fn(), listJobs: vi.fn(), deleteJob } });
    const result = await tool.execute({ jobId: 'nonexistent' }, CTX);
    expect(result.content).toContain('未找到');
  });
});

describe('createListCronTool', () => {
  it('lists cron jobs', async () => {
    const listJobs = vi.fn(async () => [
      { id: 'job-1', scheduleType: 'once', scheduleValue: '2025-12-31', prompt: 'Task 1', sessionKey: 'ses-1', nextRun: '2025-12-31T00:00:00Z', createdAt: '2025-01-01T00:00:00Z' },
      { id: 'job-2', scheduleType: 'daily', scheduleValue: '09:00', prompt: 'Task 2', sessionKey: 'ses-1', nextRun: '2025-01-02T09:00:00Z', createdAt: '2025-01-01T00:00:00Z' },
    ]);
    const tool = createListCronTool({ cronManager: { createJob: vi.fn(), listJobs, deleteJob: vi.fn() } });
    const result = await tool.execute({}, CTX);
    expect(result.content).toContain('job-1');
    expect(result.content).toContain('Task 2');
  });

  it('returns empty message when no jobs', async () => {
    const listJobs = vi.fn(async () => []);
    const tool = createListCronTool({ cronManager: { createJob: vi.fn(), listJobs, deleteJob: vi.fn() } });
    const result = await tool.execute({}, CTX);
    expect(result.content).toContain('没有定时任务');
  });
});
