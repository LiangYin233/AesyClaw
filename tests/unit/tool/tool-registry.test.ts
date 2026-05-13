/**
 * ToolRegistry unit tests.
 *
 * Tests cover: register, unregister, unregisterByOwner, getAll, get, has,
 * resolveForRole (allowlist/denylist), and error cases.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ToolRegistry, filterToolsByRole } from '../../../src/tool/tool-registry';
import type { AesyClawTool } from '../../../src/tool/tool-registry';
import type { IHooksBus } from '../../../src/hook';
import { makeRole } from '../../helpers/role';
import { Type } from '@sinclair/typebox';

// ─── Helpers ──────────────────────────────────────────────────────

function makeTool(overrides: Partial<AesyClawTool> = {}): AesyClawTool {
  return {
    name: 'test-tool',
    description: 'A test tool',
    parameters: Type.Object({ input: Type.String() }),
    owner: 'system',
    execute: async () => ({ content: 'test' }),
    ...overrides,
  };
}

/** Create a mock IHooksBus that allows all calls */
function makeNoOpHooksBus(): IHooksBus {
  return {
    register: () => undefined,
    unregister: () => undefined,
    unregisterByPrefix: () => undefined,
    enable: () => undefined,
    disable: () => undefined,
    isEnabled: () => false,
    async dispatch() {
      return { action: 'next' as const };
    },
    clear: () => undefined,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  // ─── register ──────────────────────────────────────────────────────

  describe('register', () => {
    it('should register a tool', () => {
      const tool = makeTool();
      registry.register(tool);
      expect(registry.has('test-tool')).toBe(true);
      expect(registry.get('test-tool')).toBe(tool);
    });

    it('should throw if tool with same name already exists', () => {
      const tool = makeTool();
      registry.register(tool);
      expect(() => registry.register(makeTool({ name: 'test-tool' }))).toThrow(/已注册/);
    });

    it('should register multiple tools with different names', () => {
      registry.register(makeTool({ name: 'tool-a' }));
      registry.register(makeTool({ name: 'tool-b' }));
      registry.register(makeTool({ name: 'tool-c' }));
      expect(registry.getAll()).toHaveLength(3);
    });
  });

  // ─── unregister ───────────────────────────────────────────────────

  describe('unregister', () => {
    it('should unregister a tool by name', () => {
      registry.register(makeTool());
      registry.unregister('test-tool');
      expect(registry.has('test-tool')).toBe(false);
    });

    it('should be a no-op if tool does not exist', () => {
      expect(() => registry.unregister('nonexistent')).not.toThrow();
    });
  });

  // ─── unregisterByOwner ────────────────────────────────────────────

  describe('unregisterByOwner', () => {
    it('should remove all tools owned by the given owner', () => {
      registry.register(makeTool({ name: 'tool-a', owner: 'plugin:myfeature' }));
      registry.register(makeTool({ name: 'tool-b', owner: 'plugin:myfeature' }));
      registry.register(makeTool({ name: 'tool-c', owner: 'system' }));

      registry.unregisterByOwner('plugin:myfeature');

      expect(registry.has('tool-a')).toBe(false);
      expect(registry.has('tool-b')).toBe(false);
      expect(registry.has('tool-c')).toBe(true);
    });

    it('should be a no-op if no tools match the owner', () => {
      registry.register(makeTool({ owner: 'system' }));
      registry.unregisterByOwner('plugin:nonexistent');
      expect(registry.getAll()).toHaveLength(1);
    });
  });

  // ─── getAll ─────────────────────────────────────────────────────────

  describe('getAll', () => {
    it('should return all registered tools', () => {
      registry.register(makeTool({ name: 'a' }));
      registry.register(makeTool({ name: 'b' }));
      const all = registry.getAll();
      expect(all).toHaveLength(2);
      expect(all.map((t) => t.name)).toContain('a');
      expect(all.map((t) => t.name)).toContain('b');
    });

    it('should return an empty array when no tools are registered', () => {
      expect(registry.getAll()).toEqual([]);
    });
  });

  // ─── get ────────────────────────────────────────────────────────────

  describe('get', () => {
    it('should return the tool by name', () => {
      const tool = makeTool();
      registry.register(tool);
      expect(registry.get('test-tool')).toBe(tool);
    });

    it('should return undefined for unknown tool', () => {
      expect(registry.get('nonexistent')).toBeUndefined();
    });
  });

  // ─── has ────────────────────────────────────────────────────────────

  describe('has', () => {
    it('should return true for registered tool', () => {
      registry.register(makeTool());
      expect(registry.has('test-tool')).toBe(true);
    });

    it('should return false for unregistered tool', () => {
      expect(registry.has('nonexistent')).toBe(false);
    });
  });

  // ─── resolveForRole ────────────────────────────────────────────────

  describe('resolveForRole', () => {
    const hooksBus = makeNoOpHooksBus();

    it('should return AgentTools for allowlist mode', async () => {
      registry.register(makeTool({ name: 'send_msg' }));
      registry.register(makeTool({ name: 'run_sub_agent' }));
      registry.register(makeTool({ name: 'create_cron' }));

      const role = makeRole({
        toolPermission: { mode: 'allowlist', list: ['send_msg', 'create_cron'] },
      });

      const { agentTools } = registry.resolveForRole(role, hooksBus, {});
      expect(agentTools).toHaveLength(2);
      expect(agentTools.map((t) => t.name)).toContain('send_msg');
      expect(agentTools.map((t) => t.name)).toContain('create_cron');
    });

    it('should return all AgentTools for allowlist wildcard *', async () => {
      registry.register(makeTool({ name: 'send_msg' }));
      registry.register(makeTool({ name: 'run_sub_agent' }));
      registry.register(makeTool({ name: 'create_cron' }));

      const { agentTools } = registry.resolveForRole(makeRole(), hooksBus, {});

      expect(agentTools).toHaveLength(3);
      expect(agentTools.map((t) => t.name)).toEqual(['send_msg', 'run_sub_agent', 'create_cron']);
    });

    it('should return all tools minus denied for denylist mode', async () => {
      registry.register(makeTool({ name: 'send_msg' }));
      registry.register(makeTool({ name: 'run_sub_agent' }));
      registry.register(makeTool({ name: 'create_cron' }));

      const role = makeRole({
        toolPermission: { mode: 'denylist', list: ['create_cron'] },
      });

      const { agentTools } = registry.resolveForRole(role, hooksBus, {});
      expect(agentTools).toHaveLength(2);
      expect(agentTools.map((t) => t.name)).toContain('send_msg');
      expect(agentTools.map((t) => t.name)).toContain('run_sub_agent');
      expect(agentTools.map((t) => t.name)).not.toContain('create_cron');
    });

    it('should return AgentTool objects with correct properties', async () => {
      registry.register(makeTool({ name: 'send_msg' }));

      const role = makeRole({
        toolPermission: { mode: 'allowlist', list: ['send_msg'] },
      });

      const [agentTool] = registry.resolveForRole(role, hooksBus, {}).agentTools;
      expect(agentTool.name).toBe('send_msg');
      expect(agentTool.description).toBe('A test tool');
      expect(typeof agentTool.execute).toBe('function');
    });

    it('should return empty array for allowlist with no matching tools', () => {
      registry.register(makeTool({ name: 'send_msg' }));

      const role = makeRole({
        toolPermission: { mode: 'allowlist', list: ['nonexistent_tool'] },
      });

      const { agentTools } = registry.resolveForRole(role, hooksBus, {});
      expect(agentTools).toHaveLength(0);
    });
  });
});

// ─── filterToolsByRole ──────────────────────────────────────────────

describe('filterToolsByRole', () => {
  const tools = [
    makeTool({ name: 'send_msg' }),
    makeTool({ name: 'run_sub_agent' }),
    makeTool({ name: 'create_cron' }),
  ];

  it('should keep only allowlisted tools in allowlist mode', () => {
    const role = makeRole({
      toolPermission: { mode: 'allowlist', list: ['send_msg', 'create_cron'] },
    });
    const filtered = filterToolsByRole(tools, role);
    expect(filtered).toHaveLength(2);
    expect(filtered.map((t) => t.name)).toEqual(['send_msg', 'create_cron']);
  });

  it('should exclude denylisted tools in denylist mode', () => {
    const role = makeRole({
      toolPermission: { mode: 'denylist', list: ['create_cron'] },
    });
    const filtered = filterToolsByRole(tools, role);
    expect(filtered).toHaveLength(2);
    expect(filtered.map((t) => t.name)).toEqual(['send_msg', 'run_sub_agent']);
  });

  it('should return empty array for allowlist with no matches', () => {
    const role = makeRole({
      toolPermission: { mode: 'allowlist', list: ['nonexistent'] },
    });
    const filtered = filterToolsByRole(tools, role);
    expect(filtered).toHaveLength(0);
  });

  it('should return all tools for denylist with no matches', () => {
    const role = makeRole({
      toolPermission: { mode: 'denylist', list: ['nonexistent'] },
    });
    const filtered = filterToolsByRole(tools, role);
    expect(filtered).toHaveLength(3);
  });

  it('should return all tools for allowlist with wildcard *', () => {
    const role = makeRole({
      toolPermission: { mode: 'allowlist', list: ['*'] },
    });
    const filtered = filterToolsByRole(tools, role);
    expect(filtered).toHaveLength(3);
    expect(filtered.map((t) => t.name)).toEqual(['send_msg', 'run_sub_agent', 'create_cron']);
  });
});
