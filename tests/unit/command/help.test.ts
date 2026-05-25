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
    const text = result.components[0].type === 'Plain' ? result.components[0].text : '';
    expect(text).toContain('可用命令');
    expect(text.indexOf('/clear')).toBeLessThan(text.indexOf('/help'));
    expect(text.indexOf('/help')).toBeLessThan(text.indexOf('/stop'));
    expect(text).toContain('Clear history');
    expect(text).toContain('Show help');
    expect(text).toContain('Stop processing');
  });

  it('returns empty message when no commands', async () => {
    const cmd = createHelpCommand(() => []);
    const result = await cmd.execute([], { sessionKey: KEY });
    expect(result).toEqual({ components: [{ type: 'Plain', text: '没有注册任何命令。' }] });
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
    const text = result.components[0].type === 'Plain' ? result.components[0].text : '';
    expect(text).toContain('/plugin cmd');
  });
});
