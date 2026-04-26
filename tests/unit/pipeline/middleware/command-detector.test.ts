/**
 * Command Detection unit tests.
 *
 * Tests cover: command detection, command execution, non-command passthrough,
 * unknown command handling, terminal behavior (no outbound set for non-commands).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { commandDetector } from '../../../../src/pipeline/middleware/command-detector';
import type { PipelineState } from '../../../../src/pipeline/middleware/types';
import { CommandRegistry } from '../../../../src/command/command-registry';
import type { InboundMessage } from '../../../../src/core/types';

// ─── Helpers ──────────────────────────────────────────────────────

function makeInbound(content: string): InboundMessage {
  return {
    sessionKey: { channel: 'test', type: 'private', chatId: 'user1' },
    content,
  };
}

function makeState(content: string): PipelineState {
  return { inbound: makeInbound(content) };
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('commandDetector', () => {
  let registry: CommandRegistry;

  beforeEach(() => {
    registry = new CommandRegistry();
  });

  // ─── Command detection ──────────────────────────────────────────

  describe('command detection', () => {
    it('should detect and execute a registered command', async () => {
      registry.register({
        name: 'greet',
        description: 'Greet',
        scope: 'system',
        execute: async () => 'Hello!',
      });

      const state = makeState('/greet');
      const result = await commandDetector(state, registry);

      expect(result.outbound).toBeDefined();
      expect(result.outbound!.content).toBe('Hello!');
    });

    it('should pass through non-command messages without setting outbound', async () => {
      const state = makeState('just a regular message');
      const result = await commandDetector(state, registry);

      expect(result.outbound).toBeUndefined();
    });

    it('should pass through messages that start with / but are not registered commands', async () => {
      const state = makeState('/unknown');
      const result = await commandDetector(state, registry);

      // isCommand returns false for unregistered commands, so it passes through
      expect(result.outbound).toBeUndefined();
    });

    it('should execute a namespaced command', async () => {
      registry.register({
        name: 'list',
        namespace: 'role',
        description: 'List roles',
        scope: 'system',
        execute: async () => 'role1, role2',
      });

      const state = makeState('/role list');
      const result = await commandDetector(state, registry);

      expect(result.outbound).toBeDefined();
      expect(result.outbound!.content).toBe('role1, role2');
    });

    it('should pass command args to execute function', async () => {
      let receivedArgs: string[] = [];
      registry.register({
        name: 'echo',
        description: 'Echo',
        scope: 'system',
        execute: async (args) => {
          receivedArgs = args;
          return args.join(' ');
        },
      });

      const state = makeState('/echo hello world');
      const result = await commandDetector(state, registry);

      expect(result.outbound!.content).toBe('hello world');
      expect(receivedArgs).toEqual(['hello', 'world']);
    });
  });

  // ─── Command errors ────────────────────────────────────────────

  describe('command errors', () => {
    it('should return error message when command execution fails', async () => {
      registry.register({
        name: 'fail',
        description: 'Fail',
        scope: 'system',
        execute: async () => {
          throw new Error('Command failed');
        },
      });

      const state = makeState('/fail');
      const result = await commandDetector(state, registry);

      expect(result.outbound).toBeDefined();
      expect(result.outbound!.content).toContain('Error executing command');
      expect(result.outbound!.content).toContain('Command failed');
    });

    it('should not set outbound for non-existent commands', async () => {
      const state = makeState('/nonexistent');
      const result = await commandDetector(state, registry);

      // isCommand returns false, so passes through with no outbound
      expect(result.outbound).toBeUndefined();
    });
  });
});
