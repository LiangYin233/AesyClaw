import { describe, expect, it, vi } from 'vitest';
import { registerBuiltinCommands, type BuiltinCommandDependencies } from '../../../src/command/builtin';
import { CommandRegistry } from '../../../src/command/command-registry';
import type { CommandContext, CommandDefinition, Message } from '../../../src/core/types';

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

function plainText(message: Message): string {
  const [component] = message.components;
  return component?.type === 'Plain' ? component.text : '';
}

describe('model command', () => {
  it('shows current model when no args provided and agent exists', async () => {
    const registry = new CommandRegistry();
    const getAgent = vi.fn(() => ({ modelIdentifier: 'openai/gpt-4o' }));

    registerCommands(registry, {
      agentRegistry: { getAgent },
      databaseManager: {},
      llmAdapter: {},
    });

    const cmd = getCommand(registry, 'model');
    const context: CommandContext = { sessionKey: KEY };
    const result = await cmd.execute([], context);

    expect(result).toEqual({ components: [{ type: 'Plain', text: '当前模型：openai/gpt-4o' }] });
  });

  it('shows current model from database when no agent exists', async () => {
    const registry = new CommandRegistry();
    const getAgent = vi.fn(() => null);
    const findByKey = vi.fn(async () => ({ model_id: 'anthropic/claude-3' }));

    registerCommands(registry, {
      agentRegistry: { getAgent },
      databaseManager: { sessions: { findByKey } },
      llmAdapter: {},
    });

    const cmd = getCommand(registry, 'model');
    const context: CommandContext = { sessionKey: KEY };
    const result = await cmd.execute([], context);

    expect(result).toEqual({
      components: [{ type: 'Plain', text: '当前模型：anthropic/claude-3' }],
    });
  });

  it('switches model when valid identifier provided', async () => {
    const registry = new CommandRegistry();
    const setModel = vi.fn();
    const getAgent = vi.fn(() => ({ setModel }));
    const resolveModel = vi.fn(() => ({ provider: 'openai', modelId: 'gpt-4o' }));
    const findByKey = vi.fn(() => Promise.resolve({ id: 'session-1' }));
    const setModelDb = vi.fn(() => Promise.resolve());

    registerCommands(registry, {
      agentRegistry: { getAgent },
      databaseManager: {
        sessions: { findByKey, setModel: setModelDb },
      },
      llmAdapter: { resolveModel },
    });

    const cmd = getCommand(registry, 'model');
    const context: CommandContext = { sessionKey: KEY };
    const result = await cmd.execute(['openai/gpt-4o'], context);

    expect(result).toEqual({ components: [{ type: 'Plain', text: '已切换到模型：openai/gpt-4o' }] });
    expect(setModel).toHaveBeenCalledWith('openai/gpt-4o');
  });

  it('returns error message on invalid model identifier', async () => {
    const registry = new CommandRegistry();
    const resolveModel = vi.fn(() => {
      throw new Error('Unknown provider');
    });

    registerCommands(registry, {
      agentRegistry: {},
      databaseManager: {},
      llmAdapter: { resolveModel },
    });

    const cmd = getCommand(registry, 'model');
    const context: CommandContext = { sessionKey: KEY };
    const result = await cmd.execute(['invalid/model'], context);

    const text = plainText(result);
    expect(text).toContain('无效的模型标识符');
    expect(text).toContain('Unknown provider');
  });

  it('handles no active agent when switching model', async () => {
    const registry = new CommandRegistry();
    const getAgent = vi.fn(() => null);
    const resolveModel = vi.fn(() => ({ provider: 'openai', modelId: 'gpt-4o' }));
    const findByKey = vi.fn(() => Promise.resolve({ id: 'session-1' }));
    const setModelDb = vi.fn(() => Promise.resolve());

    registerCommands(registry, {
      agentRegistry: { getAgent },
      databaseManager: {
        sessions: { findByKey, setModel: setModelDb },
      },
      llmAdapter: { resolveModel },
    });

    const cmd = getCommand(registry, 'model');
    const context: CommandContext = { sessionKey: KEY };
    const result = await cmd.execute(['openai/gpt-4o'], context);

    // Even without an active agent, the command succeeds and updates the DB
    expect(result).toEqual({
      components: [{ type: 'Plain', text: '已切换到模型：openai/gpt-4o' }],
    });
    expect(setModelDb).toHaveBeenCalledWith('session-1', 'openai/gpt-4o');
  });
});
