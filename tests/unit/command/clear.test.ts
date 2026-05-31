import { describe, expect, it, vi } from 'vitest';
import { registerBuiltinCommands } from '../../../src/command/builtin';
import { CommandRegistry } from '../../../src/command/command-registry';
import type { CommandContext } from '../../../src/command/types';

const KEY = { channel: 'desktop' as const, type: 'private' as const, chatId: 'test' };
const SESSION = { sessionId: 'session-1', key: KEY };

describe('clear command', () => {
  it('clears session history', async () => {
    const registry = new CommandRegistry();
    const clearById = vi.fn(async () => undefined);
    const findByKey = vi.fn(async () => ({ id: 'session-1' }));
    const getAgent = vi.fn(() => ({ session: { isLocked: false } }));

    registerBuiltinCommands(registry, {
      sessionManager: { clearById } as any,
      databaseManager: { sessions: { findByKey } } as any,
      agentRegistry: { getAgent } as any,
    } as any);

    const cmd = registry.getAll().find(c => c.name === 'clear')!;
    const context: CommandContext = { sessionKey: KEY };
    const result = await cmd.execute([], context);

    expect(result).toEqual({ components: [{ type: 'Plain', text: '会话历史已清空。' }] });
    expect(findByKey).toHaveBeenCalledWith(KEY);
    expect(clearById).toHaveBeenCalledWith('session-1');
  });

  it('prevents clearing when agent is locked', async () => {
    const registry = new CommandRegistry();
    const clearById = vi.fn();
    const getAgent = vi.fn(() => ({ session: { isLocked: true } }));

    registerBuiltinCommands(registry, {
      sessionManager: { clearById } as any,
      databaseManager: { sessions: { findByKey: vi.fn() } } as any,
      agentRegistry: { getAgent } as any,
    } as any);

    const cmd = registry.getAll().find(c => c.name === 'clear')!;
    const context: CommandContext = { sessionKey: KEY };
    const result = await cmd.execute([], context);

    expect(result).toEqual({
      components: [{ type: 'Plain', text: 'Agent 正在处理中，无法清空会话。' }],
    });
    expect(clearById).not.toHaveBeenCalled();
  });

  it('handles non-existent session gracefully', async () => {
    const registry = new CommandRegistry();
    const clearById = vi.fn();
    const findByKey = vi.fn(async () => null);
    const getAgent = vi.fn(() => ({ session: { isLocked: false } }));

    registerBuiltinCommands(registry, {
      sessionManager: { clearById } as any,
      databaseManager: { sessions: { findByKey } } as any,
      agentRegistry: { getAgent } as any,
    } as any);

    const cmd = registry.getAll().find(c => c.name === 'clear')!;
    const context: CommandContext = { sessionKey: KEY };
    const result = await cmd.execute([], context);

    expect(result).toEqual({ components: [{ type: 'Plain', text: '会话历史已清空。' }] });
    expect(clearById).not.toHaveBeenCalled();
  });
});
