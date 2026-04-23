/**
 * CommandRegistry unit tests.
 *
 * Tests cover: register, unregister, unregisterByScope, execute,
 * isCommand, getAll, and namespace support.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CommandRegistry } from '../../../src/command/command-registry';
import type { CommandDefinition, CommandContext } from '../../../src/core/types';

// ─── Helpers ──────────────────────────────────────────────────────

function makeContext(): CommandContext {
  return {
    sessionKey: { channel: 'test', type: 'private', chatId: 'user1' },
    sessionManager: null,
    roleManager: null,
    pluginManager: null,
  };
}

function makeCommand(overrides: Partial<CommandDefinition> = {}): CommandDefinition {
  return {
    name: 'test',
    description: 'A test command',
    scope: 'system',
    execute: async () => 'test output',
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('CommandRegistry', () => {
  let registry: CommandRegistry;

  beforeEach(() => {
    registry = new CommandRegistry();
  });

  // ─── register ──────────────────────────────────────────────────────

  describe('register', () => {
    it('should register a command', () => {
      const cmd = makeCommand({ name: 'help' });
      registry.register(cmd);
      expect(registry.getAll()).toHaveLength(1);
      expect(registry.getAll()[0].name).toBe('help');
    });

    it('should throw if command with same key already exists', () => {
      registry.register(makeCommand({ name: 'help' }));
      expect(() => registry.register(makeCommand({ name: 'help' }))).toThrow(/already registered/);
    });

    it('should allow commands with same name but different namespaces', () => {
      registry.register(makeCommand({ name: 'list', namespace: 'role' }));
      registry.register(makeCommand({ name: 'list', namespace: 'plugin' }));
      expect(registry.getAll()).toHaveLength(2);
    });

    it('should throw if namespaced command with same key exists', () => {
      registry.register(makeCommand({ name: 'list', namespace: 'role' }));
      expect(() => registry.register(makeCommand({ name: 'list', namespace: 'role' }))).toThrow(
        /already registered/,
      );
    });
  });

  // ─── unregister ───────────────────────────────────────────────────

  describe('unregister', () => {
    it('should unregister a command by name (no namespace)', () => {
      registry.register(makeCommand({ name: 'help' }));
      registry.unregister('help');
      expect(registry.getAll()).toHaveLength(0);
    });

    it('should unregister a namespaced command', () => {
      registry.register(makeCommand({ name: 'list', namespace: 'role' }));
      registry.unregister('list', 'role');
      expect(registry.getAll()).toHaveLength(0);
    });

    it('should be a no-op if command does not exist', () => {
      expect(() => registry.unregister('nonexistent')).not.toThrow();
    });

    it('should not remove command without namespace when removing namespaced', () => {
      registry.register(makeCommand({ name: 'list' }));
      registry.register(makeCommand({ name: 'list', namespace: 'role' }));
      registry.unregister('list'); // removes the non-namespaced one
      expect(registry.getAll()).toHaveLength(1);
      expect(registry.getAll()[0].namespace).toBe('role');
    });
  });

  // ─── unregisterByScope ─────────────────────────────────────────────

  describe('unregisterByScope', () => {
    it('should remove all commands with a given scope', () => {
      registry.register(makeCommand({ name: 'a', scope: 'plugin:myfeature' }));
      registry.register(makeCommand({ name: 'b', scope: 'plugin:myfeature' }));
      registry.register(makeCommand({ name: 'c', scope: 'system' }));

      registry.unregisterByScope('plugin:myfeature');

      expect(registry.getAll()).toHaveLength(1);
      expect(registry.getAll()[0].name).toBe('c');
    });

    it('should be a no-op if no commands match the scope', () => {
      registry.register(makeCommand({ scope: 'system' }));
      registry.unregisterByScope('plugin:nonexistent');
      expect(registry.getAll()).toHaveLength(1);
    });
  });

  // ─── execute ───────────────────────────────────────────────────────

  describe('execute', () => {
    it('should execute a simple command', async () => {
      registry.register(
        makeCommand({
          name: 'greet',
          execute: async () => 'Hello!',
        }),
      );

      const result = await registry.execute('/greet', makeContext());
      expect(result).toBe('Hello!');
    });

    it('should return null for non-command input', async () => {
      const result = await registry.execute('hello', makeContext());
      expect(result).toBeNull();
    });

    it('should return null for unknown command', async () => {
      const result = await registry.execute('/unknown', makeContext());
      expect(result).toBeNull();
    });

    it('should pass args to the command execute function', async () => {
      let receivedArgs: string[] = [];
      registry.register(
        makeCommand({
          name: 'echo',
          execute: async (args) => {
            receivedArgs = args;
            return args.join(' ');
          },
        }),
      );

      const result = await registry.execute('/echo hello world', makeContext());
      expect(result).toBe('hello world');
      expect(receivedArgs).toEqual(['hello', 'world']);
    });

    it('should execute a namespaced command', async () => {
      registry.register(
        makeCommand({
          name: 'list',
          namespace: 'role',
          execute: async () => 'role list',
        }),
      );

      const result = await registry.execute('/role list', makeContext());
      expect(result).toBe('role list');
    });

    it('should handle command errors gracefully', async () => {
      registry.register(
        makeCommand({
          name: 'fail',
          execute: async () => {
            throw new Error('Command failed');
          },
        }),
      );

      const result = await registry.execute('/fail', makeContext());
      expect(result).toContain('Error executing command');
      expect(result).toContain('Command failed');
    });

    it('should trim whitespace from input', async () => {
      registry.register(
        makeCommand({
          name: 'test',
          execute: async () => 'ok',
        }),
      );

      const result = await registry.execute('  /test  ', makeContext());
      expect(result).toBe('ok');
    });
  });

  // ─── isCommand ─────────────────────────────────────────────────────

  describe('isCommand', () => {
    it('should return true for a registered simple command', () => {
      registry.register(makeCommand({ name: 'help' }));
      expect(registry.isCommand('/help')).toBe(true);
    });

    it('should return true for a registered namespaced command', () => {
      registry.register(makeCommand({ name: 'list', namespace: 'role' }));
      expect(registry.isCommand('/role list')).toBe(true);
    });

    it('should return false for input not starting with /', () => {
      registry.register(makeCommand({ name: 'help' }));
      expect(registry.isCommand('help')).toBe(false);
    });

    it('should return false for unknown command', () => {
      expect(registry.isCommand('/unknown')).toBe(false);
    });

    it('should return false for empty input', () => {
      expect(registry.isCommand('')).toBe(false);
    });

    it('should return false for just /', () => {
      expect(registry.isCommand('/')).toBe(false);
    });
  });

  // ─── getAll ─────────────────────────────────────────────────────────

  describe('getAll', () => {
    it('should return all registered commands', () => {
      registry.register(makeCommand({ name: 'help' }));
      registry.register(makeCommand({ name: 'clear' }));
      expect(registry.getAll()).toHaveLength(2);
    });

    it('should return an empty array when no commands are registered', () => {
      expect(registry.getAll()).toEqual([]);
    });
  });
});