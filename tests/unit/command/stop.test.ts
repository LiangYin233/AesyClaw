import { describe, expect, it, vi } from 'vitest';
import { registerBuiltinCommands } from '../../../src/command/builtin';
import { CommandRegistry } from '../../../src/command/command-registry';
import type { BuiltinCommandDependencies } from '../../../src/command/builtin/types';
import type { CommandContext } from '../../../src/core/types';

const KEY = { channel: 'desktop' as const, type: 'private' as const, chatId: 'test' };

function registerStopCommand(
  registry: CommandRegistry,
  deps: Pick<BuiltinCommandDependencies, 'agentRegistry' | 'sessionManager'>,
): void {
  registerBuiltinCommands(registry, deps as unknown as BuiltinCommandDependencies);
}

function getStopCommand(registry: CommandRegistry) {
  const command = registry.getAll().find((candidate) => candidate.name === 'stop');
  if (!command) throw new Error('stop command not registered');
  return command;
}

describe('stop command', () => {
  it('cancels agent processing when locked', async () => {
    const registry = new CommandRegistry();
    const unlock = vi.fn();
    const create = vi.fn(async () => ({ isLocked: true, unlock }));
    const cancel = vi.fn(() => true);

    registerStopCommand(registry, {
      sessionManager: { create } as BuiltinCommandDependencies['sessionManager'],
      agentRegistry: { cancel } as unknown as BuiltinCommandDependencies['agentRegistry'],
    });

    const context: CommandContext = { sessionKey: KEY };
    const result = await getStopCommand(registry).execute([], context);

    expect(result).toEqual({ components: [{ type: 'Plain', text: 'Agent 处理已停止。' }] });
    expect(cancel).toHaveBeenCalledWith(KEY);
    expect(unlock).not.toHaveBeenCalled();
  });

  it('handles no processing to cancel', async () => {
    const registry = new CommandRegistry();
    const create = vi.fn(async () => ({ isLocked: false, unlock: vi.fn() }));

    registerStopCommand(registry, {
      sessionManager: { create } as BuiltinCommandDependencies['sessionManager'],
      agentRegistry: { cancel: vi.fn() } as unknown as BuiltinCommandDependencies['agentRegistry'],
    });

    const context: CommandContext = { sessionKey: KEY };
    const result = await getStopCommand(registry).execute([], context);

    expect(result).toEqual({ components: [{ type: 'Plain', text: 'Agent 未在处理中。' }] });
  });

  it('creates session if not exists', async () => {
    const registry = new CommandRegistry();
    const unlock = vi.fn();
    const create = vi.fn(async () => ({ isLocked: true, unlock }));

    registerStopCommand(registry, {
      sessionManager: { create } as BuiltinCommandDependencies['sessionManager'],
      agentRegistry: {
        cancel: vi.fn(() => true),
      } as unknown as BuiltinCommandDependencies['agentRegistry'],
    });

    const context: CommandContext = { sessionKey: KEY };
    await getStopCommand(registry).execute([], context);

    expect(create).toHaveBeenCalledWith(KEY);
  });
});
