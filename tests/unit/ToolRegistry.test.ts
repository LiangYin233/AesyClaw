import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolRegistry, type Tool } from '../../src/tools/ToolRegistry';

function makeTool(name: string, overrides?: Partial<Tool>): Tool {
  return {
    name,
    description: `Tool ${name}`,
    parameters: { type: 'object', properties: {} },
    execute: async () => `result from ${name}`,
    ...overrides
  };
}

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  describe('register / get / unregister', () => {
    it('should register and retrieve a tool', () => {
      registry.register(makeTool('test'));
      expect(registry.get('test')).toBeDefined();
      expect(registry.get('test')?.name).toBe('test');
    });

    it('should track source info', () => {
      registry.register(makeTool('test'), 'plugin');
      const source = registry.getSource('test');
      expect(source?.source).toBe('plugin');
      expect(source?.registeredAt).toBeLessThanOrEqual(Date.now());
    });

    it('should unregister a tool', () => {
      registry.register(makeTool('test'));
      registry.unregister('test');
      expect(registry.get('test')).toBeUndefined();
      expect(registry.getSource('test')).toBeUndefined();
    });
  });

  describe('unregisterMany', () => {
    it('should remove multiple tools and return count', () => {
      registry.register(makeTool('a'));
      registry.register(makeTool('b'));
      registry.register(makeTool('c'));
      const count = registry.unregisterMany(['a', 'c', 'nonexistent']);
      expect(count).toBe(2);
      expect(registry.get('a')).toBeUndefined();
      expect(registry.get('b')).toBeDefined();
      expect(registry.get('c')).toBeUndefined();
    });
  });

  describe('getBySource / unregisterBySource', () => {
    it('should filter tools by source', () => {
      registry.register(makeTool('a'), 'built-in');
      registry.register(makeTool('b'), 'plugin');
      registry.register(makeTool('c'), 'mcp');
      registry.register(makeTool('d'), 'plugin');

      expect(registry.getBySource('plugin')).toHaveLength(2);
      expect(registry.getBySource('mcp')).toHaveLength(1);
      expect(registry.getBySource('built-in')).toHaveLength(1);
    });

    it('should unregister all tools from a source', () => {
      registry.register(makeTool('a'), 'plugin');
      registry.register(makeTool('b'), 'plugin');
      registry.register(makeTool('c'), 'built-in');

      const count = registry.unregisterBySource('plugin');
      expect(count).toBe(2);
      expect(registry.get('a')).toBeUndefined();
      expect(registry.get('b')).toBeUndefined();
      expect(registry.get('c')).toBeDefined();
    });
  });

  describe('getDefinitions', () => {
    it('should return tool definitions', () => {
      registry.register(makeTool('test', { description: 'A test tool' }));
      const defs = registry.getDefinitions();
      expect(defs).toHaveLength(1);
      expect(defs[0]).toEqual({
        name: 'test',
        description: 'A test tool',
        parameters: { type: 'object', properties: {} }
      });
    });

    it('should exclude agentOnly tools when agentMode is false', () => {
      registry.register(makeTool('public'));
      registry.register(makeTool('agent', { agentOnly: true }));
      const defs = registry.getDefinitions(false);
      expect(defs).toHaveLength(1);
      expect(defs[0].name).toBe('public');
    });

    it('should include agentOnly tools when agentMode is true', () => {
      registry.register(makeTool('public'));
      registry.register(makeTool('agent', { agentOnly: true }));
      const defs = registry.getDefinitions(true);
      expect(defs).toHaveLength(2);
    });
  });

  describe('list', () => {
    it('should return all tools', () => {
      registry.register(makeTool('a'));
      registry.register(makeTool('b'));
      expect(registry.list()).toHaveLength(2);
    });
  });

  describe('execute', () => {
    it('should execute a tool and return result', async () => {
      registry.register(makeTool('test', {
        execute: async () => 'hello'
      }));
      const result = await registry.execute('test', {});
      expect(result).toBe('hello');
    });

    it('should throw when tool not found', async () => {
      await expect(registry.execute('nonexistent', {})).rejects.toThrow('Tool not found');
    });

    it('should throw on validation errors', async () => {
      registry.register(makeTool('test', {
        validate: () => ['param is required']
      }));
      await expect(registry.execute('test', {})).rejects.toThrow('Validation errors');
    });

    it('should pass validation when no errors', async () => {
      registry.register(makeTool('test', {
        validate: () => [],
        execute: async () => 'ok'
      }));
      const result = await registry.execute('test', {});
      expect(result).toBe('ok');
    });

    it('should pass params to execute function', async () => {
      const executeFn = vi.fn().mockResolvedValue('done');
      registry.register(makeTool('test', { execute: executeFn }));
      await registry.execute('test', { key: 'value' });
      expect(executeFn).toHaveBeenCalledWith(
        { key: 'value' },
        expect.objectContaining({ workspace: '' })
      );
    });

    it('should timeout long-running tools', async () => {
      registry.register(makeTool('slow', {
        timeout: 50,
        execute: async () => new Promise(resolve => setTimeout(() => resolve('late'), 5000))
      }));
      await expect(registry.execute('slow', {})).rejects.toThrow();
    }, 10000);
  });

  describe('getAllSources', () => {
    it('should return source info for all tools', () => {
      registry.register(makeTool('a'), 'built-in');
      registry.register(makeTool('b'), 'mcp');
      const sources = registry.getAllSources();
      expect(sources).toHaveLength(2);
      expect(sources.map(s => s.name).sort()).toEqual(['a', 'b']);
    });
  });
});
