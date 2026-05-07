/**
 * ConfigManager unit tests.
 *
 * Tests cover: load, path-based get/set/patch, hot-reload, defaults sync.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConfigManager } from '../../../../src/core/config/config-manager';
import type { RoleConfig } from '../../../../src/core/types';

const TEST_BASE = join(tmpdir(), 'aesyclaw-test-config');

describe('ConfigManager', () => {
  let manager: ConfigManager;
  let testRoot: string;
  let configPath: string;
  let rolesPath: string;

  beforeEach(() => {
    // Create a unique temp root for each test
    testRoot = join(TEST_BASE, `test-${Date.now()}`);
    mkdirSync(testRoot, { recursive: true });
    configPath = join(testRoot, '.aesyclaw', 'config.json');
    rolesPath = join(testRoot, '.aesyclaw', 'roles.json');

    // ConfigManager auto-initializes with the test root
    manager = new ConfigManager(testRoot);
  });

  afterEach(() => {
    manager.stopHotReload();
    // Clean up temp root
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    // Clean up test base directory
    if (existsSync(TEST_BASE)) {
      rmSync(TEST_BASE, { recursive: true, force: true });
    }
  });

  describe('load', () => {
    it('should create default config and roles files if they do not exist', () => {
      expect(existsSync(configPath)).toBe(true);
      expect(manager.get('server.port')).toBe(3000);
      expect(manager.get('server.host')).toBe('0.0.0.0');
      expect(manager.get('server.logLevel')).toBe('info');
    });

    it('should create runtime directories', () => {
      expect(existsSync(join(testRoot, '.aesyclaw'))).toBe(true);
      expect(existsSync(join(testRoot, '.aesyclaw', 'data'))).toBe(true);
      expect(existsSync(join(testRoot, '.aesyclaw', 'media'))).toBe(true);
      expect(existsSync(join(testRoot, '.aesyclaw', 'workspace'))).toBe(true);
    });

    it('should load an existing config file', () => {
      // Write config before creating manager
      const existingConfig = {
        server: { port: 8080, host: 'localhost', logLevel: 'debug' },
        providers: {},
        channels: {},
        agent: {
          memory: { compressionThreshold: 0.7 },
          multimodal: {
            speechToText: { provider: 'test', model: 'test-model' },
            imageUnderstanding: { provider: 'test', model: 'test-model' },
          },
        },
        mcp: [],
        plugins: [],
      };
      mkdirSync(join(testRoot, '.aesyclaw'), { recursive: true });
      writeFileSync(configPath, JSON.stringify(existingConfig, null, 2));

      // Create new manager that loads existing config
      manager.stopHotReload();
      manager = new ConfigManager(testRoot);

      expect(manager.get('server.port')).toBe(8080);
      expect(manager.get('server.host')).toBe('localhost');
    });

    it('should throw on invalid JSON', () => {
      mkdirSync(join(testRoot, '.aesyclaw'), { recursive: true });
      writeFileSync(configPath, 'not json');

      expect(() => new ConfigManager(testRoot)).toThrow();
    });

    it('should reject explicitly invalid values instead of coercing them', () => {
      const invalidConfig = {
        server: { port: '3000', host: 'localhost', logLevel: 'info' },
        providers: {},
        channels: {},
        agent: {
          memory: { compressionThreshold: 0.8 },
          multimodal: {
            speechToText: { provider: 'openai', model: 'whisper-1' },
            imageUnderstanding: { provider: 'openai', model: 'gpt-4o' },
          },
        },
        mcp: [],
        plugins: [],
      };
      mkdirSync(join(testRoot, '.aesyclaw'), { recursive: true });
      writeFileSync(configPath, JSON.stringify(invalidConfig, null, 2));

      expect(() => new ConfigManager(testRoot)).toThrow();
    });

    it('should still fill defaults for missing optional fields', () => {
      const partialConfig = {
        server: { port: 8080, host: 'localhost', logLevel: 'debug' },
        providers: {},
        channels: {},
        agent: {
          memory: { compressionThreshold: 0.7 },
          multimodal: {
            speechToText: { provider: 'test', model: 'test-model' },
            imageUnderstanding: { provider: 'test', model: 'test-model' },
          },
        },
        mcp: [{ name: 'local', transport: 'stdio' }],
        plugins: [{ name: 'example-plugin' }],
      };
      mkdirSync(join(testRoot, '.aesyclaw'), { recursive: true });
      writeFileSync(configPath, JSON.stringify(partialConfig, null, 2));

      manager.stopHotReload();
      manager = new ConfigManager(testRoot);

      const mcp = manager.get('mcp') as Array<{ enabled?: boolean }>;
      const plugins = manager.get('plugins') as Array<{ enabled?: boolean }>;
      expect(mcp[0]?.enabled).toBe(true);
      expect(plugins[0]?.enabled).toBe(true);
    });
  });

  describe('roles store', () => {
    const customRole: RoleConfig = {
      id: 'custom',
      description: 'Custom role',
      systemPrompt: 'Hi',
      model: 'openai/gpt-4o',
      toolPermission: { mode: 'allowlist', list: [] },
      skills: [],
      enabled: true,
    };

    it('should create a default roles file if one does not exist', () => {
      expect(existsSync(rolesPath)).toBe(true);
      expect(manager.getRoles()).toEqual([
        expect.objectContaining({ id: 'default', enabled: true }),
      ]);
      expect(JSON.parse(readFileSync(rolesPath, 'utf-8'))).toEqual([
        expect.objectContaining({ id: 'default', enabled: true }),
      ]);
    });

    it('should load an existing roles file', () => {
      mkdirSync(join(testRoot, '.aesyclaw'), { recursive: true });
      writeFileSync(rolesPath, JSON.stringify([customRole], null, 2));

      manager.stopHotReload();
      manager = new ConfigManager(testRoot);

      expect(manager.getRoles()).toEqual([expect.objectContaining({ id: 'custom' })]);
    });

    it('should reject invalid roles file values', () => {
      mkdirSync(join(testRoot, '.aesyclaw'), { recursive: true });
      writeFileSync(rolesPath, JSON.stringify([{ id: 'bad', enabled: 'true' }], null, 2));

      expect(() => new ConfigManager(testRoot)).toThrow(/角色配置验证失败/);
    });

    it('should reject duplicate role ids', () => {
      const duplicate = { ...customRole, id: 'same' };
      mkdirSync(join(testRoot, '.aesyclaw'), { recursive: true });
      writeFileSync(rolesPath, JSON.stringify([duplicate, duplicate], null, 2));

      expect(() => new ConfigManager(testRoot)).toThrow(/角色 id.*重复/);
    });
  });

  describe('path-based get/set/patch', () => {
    it('should read nested values by path', () => {
      expect(manager.get('server.port')).toBe(3000);
      expect(manager.get('agent.memory.compressionThreshold')).toBe(0.8);
      expect(manager.get('missing.path')).toBeUndefined();
    });

    it('should return cloned values from get and getRoles', () => {
      const server = manager.get('server') as { port: number };
      server.port = 9999;
      expect(manager.get('server.port')).toBe(3000);

      const roles = manager.getRoles() as RoleConfig[];
      const firstRole = roles[0];
      if (!firstRole) throw new Error('expected default role');
      roles[0] = { ...firstRole, id: 'mutated' };
      expect(manager.getRoles()[0]?.id).toBe('default');
    });

    it('should set a nested scalar path and persist it', async () => {
      await manager.set('server.authToken', 'secret-token');

      expect(manager.get('server.authToken')).toBe('secret-token');
      const fileContent = JSON.parse(readFileSync(configPath, 'utf-8')) as {
        server: { authToken?: string };
      };
      expect(fileContent.server.authToken).toBe('secret-token');
    });

    it('should patch object paths by deep merging', async () => {
      await manager.patch('server', { authToken: 'patched-token' });

      expect(manager.get('server.port')).toBe(3000);
      expect(manager.get('server.authToken')).toBe('patched-token');
    });

    it('should replace array values as whole paths', async () => {
      await manager.set('plugins', [{ name: 'example-plugin', enabled: false }]);

      expect(manager.get('plugins')).toEqual([{ name: 'example-plugin', enabled: false }]);
    });

    it('should reject array element paths', async () => {
      expect(() => manager.get('mcp.0.enabled')).toThrow(/数组路径/);
      await expect(manager.set('plugins.0.enabled', false)).rejects.toThrow(/数组路径/);
    });

    it('should reject invalid set values before persisting', async () => {
      await expect(manager.set('server.port', '3000')).rejects.toBeInstanceOf(Error);

      expect(manager.get('server.port')).toBe(3000);
      const fileContent = JSON.parse(readFileSync(configPath, 'utf-8')) as {
        server: { port: number };
      };
      expect(fileContent.server.port).toBe(3000);
    });

    it('should reject patching scalar targets', async () => {
      await expect(manager.patch('server.port', {})).rejects.toThrow(/对象/);
    });

    it('should set roles and reject duplicate role ids', async () => {
      const role: RoleConfig = {
        id: 'new',
        description: 'New role',
        systemPrompt: 'Hi',
        model: 'openai/gpt-4o',
        toolPermission: { mode: 'allowlist', list: [] },
        skills: [],
        enabled: true,
      };
      await manager.setRoles([role]);

      expect(manager.getRoles()).toEqual([expect.objectContaining({ id: 'new' })]);
      await expect(manager.setRoles([role, role])).rejects.toThrow(/角色 id.*重复/);
    });
  });

  describe('registerDefaults and syncDefaults', () => {
    it('should merge registered defaults into config', async () => {
      manager.registerDefaults('channels.testchannel', { enabled: true, url: 'ws://localhost' });
      await manager.syncDefaults();

      const channels = manager.get('channels') as Record<string, unknown>;
      expect(channels.testchannel).toBeDefined();
    });

    it('should preserve existing channel values during syncDefaults', async () => {
      const existingConfig = {
        server: { port: 3000, host: '0.0.0.0', logLevel: 'info' },
        providers: {},
        channels: {
          testchannel: {
            enabled: false,
            url: 'wss://user-configured.example',
            nested: { retries: 5 },
          },
        },
        agent: {
          memory: { compressionThreshold: 0.8 },
          multimodal: {
            speechToText: { provider: 'openai', model: 'whisper-1' },
            imageUnderstanding: { provider: 'openai', model: 'gpt-4o' },
          },
        },
        mcp: [],
        plugins: [],
      };
      mkdirSync(join(testRoot, '.aesyclaw'), { recursive: true });
      writeFileSync(configPath, JSON.stringify(existingConfig, null, 2));

      manager.stopHotReload();
      manager = new ConfigManager(testRoot);

      manager.registerDefaults('channels.testchannel', {
        enabled: true,
        url: 'ws://localhost',
        nested: { retries: 3, timeoutMs: 1000 },
      });

      await manager.syncDefaults();

      const testChannel = (manager.get('channels') as Record<string, Record<string, unknown>>)
        .testchannel;
      expect(testChannel.enabled).toBe(false);
      expect(testChannel.url).toBe('wss://user-configured.example');
      expect(testChannel.nested).toEqual({ retries: 5, timeoutMs: 1000 });
    });

    it('should backfill missing nested channel fields during syncDefaults', async () => {
      const existingConfig = {
        server: { port: 3000, host: '0.0.0.0', logLevel: 'info' },
        providers: {},
        channels: {
          testchannel: {
            nested: { retries: 2 },
          },
        },
        agent: {
          memory: { compressionThreshold: 0.8 },
          multimodal: {
            speechToText: { provider: 'openai', model: 'whisper-1' },
            imageUnderstanding: { provider: 'openai', model: 'gpt-4o' },
          },
        },
        mcp: [],
        plugins: [],
      };
      mkdirSync(join(testRoot, '.aesyclaw'), { recursive: true });
      writeFileSync(configPath, JSON.stringify(existingConfig, null, 2));

      manager.stopHotReload();
      manager = new ConfigManager(testRoot);

      manager.registerDefaults('channels.testchannel', {
        enabled: true,
        nested: { retries: 3, timeoutMs: 1000 },
      });

      await manager.syncDefaults();

      const testChannel = (manager.get('channels') as Record<string, Record<string, unknown>>)
        .testchannel;
      expect(testChannel.enabled).toBe(true);
      expect(testChannel.nested).toEqual({ retries: 2, timeoutMs: 1000 });
    });

    it('should reject invalid synced defaults before persisting', async () => {
      manager.registerDefaults('providers.test-provider', {
        apiType: 'openai-responses',
        apiKey: 123,
      } as never);

      await expect(manager.syncDefaults()).rejects.toBeInstanceOf(Error);
      expect(manager.get('providers')).toEqual({});
      const fileContent = JSON.parse(
        readFileSync(configPath, 'utf-8'),
      ) as { providers: Record<string, unknown> };
      expect(fileContent.providers).toEqual({});
    });
  });

  describe('hot reload', () => {
    it('should refresh cache on valid hot reload changes', async () => {
      manager.startHotReload();
      await new Promise((resolve) => setTimeout(resolve, 100));

      const updated = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
      updated.server = { port: 7777, host: '127.0.0.1', logLevel: 'debug' };
      writeFileSync(configPath, JSON.stringify(updated, null, 2));
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(manager.get('server.port')).toBe(7777);
    });

    it('should keep previous cache on invalid hot reload changes', async () => {
      manager.startHotReload();
      await new Promise((resolve) => setTimeout(resolve, 100));

      writeFileSync(configPath, JSON.stringify({ server: { port: 'bad' } }, null, 2));
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(manager.get('server.port')).toBe(3000);
    });
  });

  describe('resolvedPaths', () => {
    it('should expose resolved paths', () => {
      const paths = manager.resolvedPaths;
      expect(paths.runtimeRoot).toBe(join(testRoot, '.aesyclaw'));
      expect(paths.configFile).toBe(configPath);
      expect(paths.rolesFile).toBe(rolesPath);
    });
  });
});
