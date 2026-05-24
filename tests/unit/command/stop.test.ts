import { describe, expect, it, vi } from 'vitest';
import { createStopCommand } from '../../../src/command/builtin/stop';

const KEY = { channel: 'desktop' as const, type: 'private' as const, chatId: 'test' };

describe('createStopCommand', () => {
  it('stops agent processing', async () => {
    const unlock = vi.fn();
    const cmd = createStopCommand(
      { get: vi.fn(() => ({ unlock })) } as never,
      { cancel: vi.fn(() => true) } as never,
    );
    const result = await cmd.execute([], { sessionKey: KEY });
    expect(result).toBe('Agent 处理已中止。');
    expect(unlock).toHaveBeenCalled();
  });

  it('handles no active session', async () => {
    const cmd = createStopCommand(
      { get: vi.fn(() => null) } as never,
      { cancel: vi.fn() } as never,
    );
    const result = await cmd.execute([], { sessionKey: KEY });
    expect(result).toBe('没有找到活跃会话。');
  });

  it('handles no processing to cancel', async () => {
    const cmd = createStopCommand(
      { get: vi.fn(() => ({ unlock: vi.fn() })) } as never,
      { cancel: vi.fn(() => false) } as never,
    );
    const result = await cmd.execute([], { sessionKey: KEY });
    expect(result).toBe('没有正在进行的处理。');
  });
});
