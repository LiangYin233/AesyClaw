import { describe, expect, it, vi } from 'vitest';
import {
  registerBuiltinCommands,
  type BuiltinCommandDependencies,
} from '../../../src/command/builtin';
import { CommandRegistry } from '../../../src/command/command-registry';
import type { CommandContext, CommandDefinition } from '../../../src/core/types';

const KEY = { channel: 'desktop' as const, type: 'private' as const, chatId: 'test' };

type MockDeps = Record<string, unknown>;

function registerCommands(registry: CommandRegistry, deps: MockDeps): void {
  registerBuiltinCommands(registry, deps as unknown as BuiltinCommandDependencies);
}

function getCommand(registry: CommandRegistry, name: string): CommandDefinition {
  const command = registry.getAll().find((candidate) => candidate.name === name);
  if (command === undefined) throw new Error(`Command not found: ${name}`);
  return command;
}

describe('clear command', () => {
  it('clears session history', async () => {
    const registry = new CommandRegistry();
    const clearById = vi.fn(async () => undefined);
    const findByKey = vi.fn(async () => ({ id: 'session-1' }));
    const getAgent = vi.fn(() => ({ session: { isLocked: false } }));
    const unregisterAgent = vi.fn();

    registerCommands(registry, {
      sessionManager: { clearById },
      databaseManager: { sessions: { findByKey } },
      agentRegistry: { getAgent, unregisterAgent },
    });

    const cmd = getCommand(registry, 'clear');
    const context: CommandContext = { sessionKey: KEY };
    const result = await cmd.execute([], context);

    expect(result).toEqual({ components: [{ type: 'Plain', text: '会话历史已清空。' }] });
    expect(findByKey).toHaveBeenCalledWith(KEY);
    expect(clearById).toHaveBeenCalledWith('session-1');
    expect(unregisterAgent).toHaveBeenCalledWith(KEY);
  });

  it('prevents clearing when agent is locked', async () => {
    const registry = new CommandRegistry();
    const clearById = vi.fn();
    const getAgent = vi.fn(() => ({ session: { isLocked: true } }));

    registerCommands(registry, {
      sessionManager: { clearById },
      databaseManager: { sessions: { findByKey: vi.fn() } },
      agentRegistry: { getAgent },
    });

    const cmd = getCommand(registry, 'clear');
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
    const unregisterAgent = vi.fn();

    registerCommands(registry, {
      sessionManager: { clearById },
      databaseManager: { sessions: { findByKey } },
      agentRegistry: { getAgent, unregisterAgent },
    });

    const cmd = getCommand(registry, 'clear');
    const context: CommandContext = { sessionKey: KEY };
    const result = await cmd.execute([], context);

    expect(result).toEqual({ components: [{ type: 'Plain', text: '会话历史已清空。' }] });
    expect(clearById).not.toHaveBeenCalled();
    expect(unregisterAgent).not.toHaveBeenCalled();
  });
});
