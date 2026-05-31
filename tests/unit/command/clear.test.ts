import { describe, expect, it, vi } from 'vitest';
import { createClearCommand } from '../../../src/command/builtin/clear';

const KEY = { channel: 'desktop' as const, type: 'private' as const, chatId: 'test' };
const SESSION = { sessionId: 'session-1' };

describe('createClearCommand', () => {
  it('clears session history', async () => {
    const clearById = vi.fn(async () => undefined);
    const create = vi.fn(async () => SESSION);
    const cmd = createClearCommand(
      { create, clearById, deleteById: vi.fn() },
      { unregisterAgent: vi.fn() },
    );
    const result = await cmd.execute([], { sessionKey: KEY });
    expect(result).toEqual({ components: [{ type: 'Plain', text: '当前会话历史已清除。' }] });
    expect(create).toHaveBeenCalledWith(KEY);
    expect(clearById).toHaveBeenCalledWith('session-1');
  });

  it('deletes session with delete arg', async () => {
    const deleteById = vi.fn(async () => true);
    const unregister = vi.fn();
    const cmd = createClearCommand(
      { create: vi.fn(async () => SESSION), clearById: vi.fn(), deleteById },
      { unregisterAgent: unregister },
    );
    const result = await cmd.execute(['delete'], { sessionKey: KEY });
    expect(result).toEqual({ components: [{ type: 'Plain', text: '当前会话已删除。' }] });
    expect(deleteById).toHaveBeenCalledWith('session-1');
    expect(unregister).toHaveBeenCalledWith(KEY);
  });

  it('handles non-existent session on delete', async () => {
    const deleteById = vi.fn(async () => false);
    const cmd = createClearCommand(
      { create: vi.fn(async () => SESSION), clearById: vi.fn(), deleteById },
      { unregisterAgent: vi.fn() },
    );
    const result = await cmd.execute(['delete'], { sessionKey: KEY });
    expect(result).toEqual({ components: [{ type: 'Plain', text: '当前会话不存在或已被删除。' }] });
  });

  it('handles case-insensitive delete arg', async () => {
    const deleteById = vi.fn(async () => true);
    const cmd = createClearCommand(
      { create: vi.fn(async () => SESSION), clearById: vi.fn(), deleteById },
      { unregisterAgent: vi.fn() },
    );
    const result = await cmd.execute(['Delete'], { sessionKey: KEY });
    expect(result).toEqual({ components: [{ type: 'Plain', text: '当前会话已删除。' }] });
  });
});
