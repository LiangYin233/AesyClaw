import { describe, expect, it, vi } from 'vitest';
import { createHelpCommand } from '../../../src/command/builtin/help';

const KEY = { channel: 'desktop' as const, type: 'private' as const, chatId: 'test' };

describe('createHelpCommand', () => {
  it('lists all commands sorted by name', async () => {
    const cmd = createHelpCommand(() => [
      { name: 'stop', description: 'Stop processing', scope: 'system', execute: vi.fn() },
      { name: 'clear', description: 'Clear history', scope: 'system', execute: vi.fn() },
      { name: 'help', description: 'Show help', scope: 'system', execute: vi.fn() },
    ]);
    const result = await cmd.execute([], { sessionKey: KEY });
    expect(result).toContain('可用命令');
    expect(result.indexOf('/clear')).toBeLessThan(result.indexOf('/help'));
    expect(result.indexOf('/help')).toBeLessThan(result.indexOf('/stop'));
    expect(result).toContain('Clear history');
    expect(result).toContain('Show help');
    expect(result).toContain('Stop processing');
  });

  it('returns empty message when no commands', async () => {
    const cmd = createHelpCommand(() => []);
    const result = await cmd.execute([], { sessionKey: KEY });
    expect(result).toBe('没有注册任何命令。');
  });

  it('uses namespace:name format when namespace is present', async () => {
    const cmd = createHelpCommand(() => [
      {
        name: 'cmd',
        namespace: 'plugin',
        description: 'Plugin command',
        scope: 'system',
        execute: vi.fn(),
      },
    ]);
    const result = await cmd.execute([], { sessionKey: KEY });
    expect(result).toContain('/plugin cmd');
  });
});
