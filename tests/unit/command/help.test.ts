import { describe, expect, it } from 'vitest';
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

function minimalDeps(): MockDeps {
  return {
    sessionManager: {},
    databaseManager: {},
    agentRegistry: {},
    roleManager: {},
    skillManager: {},
    pluginManager: {},
    channelManager: {},
    agentFactory: {},
  };
}

describe('help command', () => {
  it('lists all commands', async () => {
    const registry = new CommandRegistry();

    registerCommands(registry, minimalDeps());

    const cmd = getCommand(registry, 'help');
    const context: CommandContext = { sessionKey: KEY };
    const result = await cmd.execute([], context);

    const text = plainText(result);
    expect(text).toContain('可用命令：');
    expect(text).toContain('/help');
    expect(text).toContain('/clear');
    expect(text).toContain('/stop');
  });

  it('returns empty message when no commands', async () => {
    const emptyRegistry = new CommandRegistry();

    emptyRegistry.register({
      name: 'help',
      description: '列出所有可用命令',
      scope: 'system',
      allowDuringAgentProcessing: true,
      execute: async (): Promise<Message> => {
        return { components: [{ type: 'Plain', text: '没有注册任何命令。' }] };
      },
    });

    const cmd = getCommand(emptyRegistry, 'help');
    const context: CommandContext = { sessionKey: KEY };
    const result = await cmd.execute([], context);

    expect(result).toEqual({ components: [{ type: 'Plain', text: '没有注册任何命令。' }] });
  });

  it('includes command descriptions', async () => {
    const registry = new CommandRegistry();

    registerCommands(registry, minimalDeps());

    const cmd = getCommand(registry, 'help');
    const context: CommandContext = { sessionKey: KEY };
    const result = await cmd.execute([], context);

    const text = plainText(result);
    expect(text).toContain('列出所有可用命令');
    expect(text).toContain('清空当前会话的历史记录');
  });
});
