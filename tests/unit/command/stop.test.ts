import { describe, expect, it, vi } from 'vitest';
import { registerBuiltinCommands } from '../../../src/command/builtin';
import { CommandRegistry } from '../../../src/command/command-registry';
import type { CommandContext } from '../../../src/command/types';

const KEY = { channel: 'desktop' as const, type: 'private' as const, chatId: 'test' };

describe('stop command', () => {
  it('stops agent processing when locked', async () => {
    const registry = new CommandRegistry();
    const unlock = vi.fn();
    const create = vi.fn(async () => ({ isLocked: true, unlock }));

    registerBuiltinCommands(registry, {
      sessionManager: { create } as any,
    } as any);

    const cmd = registry.getAll().find(c => c.name === 'stop')!;
    const context: CommandContext = { sessionKey: KEY };
    const result = await cmd.execute([], context);

    expect(result).toEqual({ components: [{ type: 'Plain', text: 'Agent 处理已停止。' }] });
    expect(unlock).toHaveBeenCalled();
  });

  it('handles no processing to cancel', async () => {
    const registry = new CommandRegistry();
    const create = vi.fn(async () => ({ isLocked: false, unlock: vi.fn() }));

    registerBuiltinCommands(registry, {
      sessionManager: { create } as any,
    } as any);

    const cmd = registry.getAll().find(c => c.name === 'stop')!;
    const context: CommandContext = { sessionKey: KEY };
    const result = await cmd.execute([], context);

    expect(result).toEqual({ components: [{ type: 'Plain', text: 'Agent 未在处理中。' }] });
  });

  it('creates session if not exists', async () => {
    const registry = new CommandRegistry();
    const unlock = vi.fn();
    const create = vi.fn(async () => ({ isLocked: true, unlock }));

    registerBuiltinCommands(registry, {
      sessionManager: { create } as any,
    } as any);

    const cmd = registry.getAll().find(c => c.name === 'stop')!;
    const context: CommandContext = { sessionKey: KEY };
    await cmd.execute([], context);

    expect(create).toHaveBeenCalledWith(KEY);
  });
});
