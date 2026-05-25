import { describe, expect, it, vi } from 'vitest';
import { createClearCommand } from '../../../src/command/builtin/clear';

const KEY = { channel: 'desktop' as const, type: 'private' as const, chatId: 'test' };

describe('createClearCommand', () => {
  it('clears session history', async () => {
    const clear = vi.fn(async () => undefined);
    const cmd = createClearCommand({ clear, delete: vi.fn() }, { unregisterAgent: vi.fn() });
    const result = await cmd.execute([], { sessionKey: KEY });
    expect(result).toEqual({ components: [{ type: 'Plain', text: '当前会话历史已清除。' }] });
    expect(clear).toHaveBeenCalledWith(KEY);
  });

  it('deletes session with delete arg', async () => {
    const del = vi.fn(async () => true);
    const unregister = vi.fn();
    const cmd = createClearCommand(
      { clear: vi.fn(), delete: del },
      { unregisterAgent: unregister },
    );
    const result = await cmd.execute(['delete'], { sessionKey: KEY });
    expect(result).toEqual({ components: [{ type: 'Plain', text: '当前会话已删除。' }] });
    expect(del).toHaveBeenCalledWith(KEY);
    expect(unregister).toHaveBeenCalledWith(KEY);
  });

  it('handles non-existent session on delete', async () => {
    const del = vi.fn(async () => false);
    const cmd = createClearCommand({ clear: vi.fn(), delete: del }, { unregisterAgent: vi.fn() });
    const result = await cmd.execute(['delete'], { sessionKey: KEY });
    expect(result).toEqual({ components: [{ type: 'Plain', text: '当前会话不存在或已被删除。' }] });
  });

  it('handles case-insensitive delete arg', async () => {
    const del = vi.fn(async () => true);
    const cmd = createClearCommand({ clear: vi.fn(), delete: del }, { unregisterAgent: vi.fn() });
    const result = await cmd.execute(['Delete'], { sessionKey: KEY });
    expect(result).toEqual({ components: [{ type: 'Plain', text: '当前会话已删除。' }] });
  });
});
