import { describe, expect, it, vi } from 'vitest';
import { createClearCommand } from '../../../src/command/builtin/clear';
import type { CommandContext } from '../../../src/core/types';

function makeContext(): CommandContext {
  return {
    sessionKey: { channel: 'desktop', type: 'private', chatId: 'chat-1' },
  };
}

describe('clear command', () => {
  it('clears current session history by default', async () => {
    const sessionManager = {
      clear: vi.fn(async () => undefined),
      delete: vi.fn(async () => true),
    };
    const agentRegistry = { unregisterAgent: vi.fn() };
    const command = createClearCommand(sessionManager as never, agentRegistry as never);

    await expect(command.execute([], makeContext())).resolves.toBe('当前会话历史已清除。');

    expect(sessionManager.clear).toHaveBeenCalledWith(makeContext().sessionKey);
    expect(sessionManager.delete).not.toHaveBeenCalled();
    expect(agentRegistry.unregisterAgent).not.toHaveBeenCalled();
  });

  it('deletes current session for /clear delete', async () => {
    const sessionManager = {
      clear: vi.fn(async () => undefined),
      delete: vi.fn(async () => true),
    };
    const agentRegistry = { unregisterAgent: vi.fn() };
    const command = createClearCommand(sessionManager as never, agentRegistry as never);

    await expect(command.execute(['delete'], makeContext())).resolves.toBe('当前会话已删除。');

    expect(sessionManager.clear).not.toHaveBeenCalled();
    expect(sessionManager.delete).toHaveBeenCalledWith(makeContext().sessionKey);
    expect(agentRegistry.unregisterAgent).toHaveBeenCalledWith(makeContext().sessionKey);
  });
});
