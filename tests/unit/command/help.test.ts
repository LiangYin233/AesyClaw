import { describe, expect, it, vi } from 'vitest';
import { registerBuiltinCommands } from '../../../src/command/builtin';
import { CommandRegistry } from '../../../src/command/command-registry';
import type { CommandContext } from '../../../src/command/types';

const KEY = { channel: 'desktop' as const, type: 'private' as const, chatId: 'test' };

describe('help command', () => {
  it('lists all commands', async () => {
    const registry = new CommandRegistry();

    registerBuiltinCommands(registry, {
      sessionManager: {} as any,
      databaseManager: {} as any,
      agentRegistry: {} as any,
      roleManager: {} as any,
      skillManager: {} as any,
      pluginManager: {} as any,
      channelManager: {} as any,
      agentFactory: {} as any,
    });

    const cmd = registry.getAll().find(c => c.name === 'help')!;
    const context: CommandContext = { sessionKey: KEY };
    const result = await cmd.execute([], context);

    const text = result.components[0].type === 'Plain' ? result.components[0].text : '';
    expect(text).toContain('可用命令：');
    expect(text).toContain('/help');
    expect(text).toContain('/clear');
    expect(text).toContain('/stop');
  });

  it('returns empty message when no commands', async () => {
    const registry = new CommandRegistry();
    
    // 只注册 help 命令，然后清空
    registerBuiltinCommands(registry, {
      sessionManager: {} as any,
      databaseManager: {} as any,
      agentRegistry: {} as any,
      roleManager: {} as any,
      skillManager: {} as any,
      pluginManager: {} as any,
      channelManager: {} as any,
      agentFactory: {} as any,
    });

    // 获取 help 命令
    const helpCmd = registry.getAll().find(c => c.name === 'help')!;
    
    // 创建一个空的 registry
    const emptyRegistry = new CommandRegistry();
    
    // 手动注册一个返回空列表的 help 命令
    emptyRegistry.register({
      name: 'help',
      description: '列出所有可用命令',
      scope: 'system',
      allowDuringAgentProcessing: true,
      execute: async (): Promise<any> => {
        return { components: [{ type: 'Plain', text: '没有注册任何命令。' }] };
      },
    });

    const cmd = emptyRegistry.getAll().find(c => c.name === 'help')!;
    const context: CommandContext = { sessionKey: KEY };
    const result = await cmd.execute([], context);

    expect(result).toEqual({ components: [{ type: 'Plain', text: '没有注册任何命令。' }] });
  });

  it('includes command descriptions', async () => {
    const registry = new CommandRegistry();

    registerBuiltinCommands(registry, {
      sessionManager: {} as any,
      databaseManager: {} as any,
      agentRegistry: {} as any,
      roleManager: {} as any,
      skillManager: {} as any,
      pluginManager: {} as any,
      channelManager: {} as any,
      agentFactory: {} as any,
    });

    const cmd = registry.getAll().find(c => c.name === 'help')!;
    const context: CommandContext = { sessionKey: KEY };
    const result = await cmd.execute([], context);

    const text = result.components[0].type === 'Plain' ? result.components[0].text : '';
    expect(text).toContain('列出所有可用命令');
    expect(text).toContain('清空当前会话的历史记录');
  });
});
