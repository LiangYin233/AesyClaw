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

const TEST_DIR = join(tmpdir(), 'aesyclaw-test-config');

describe('ConfigManager', () => {
  let manager: ConfigManager;
  let configPath: string;
  let rolesPath: string;

  beforeEach(() => {
    manager = new ConfigManager();
    // Create a unique temp dir for each test
    configPath = join(TEST_DIR, `config-${Date.now()}.json`);
    rolesPath = join(TEST_DIR, `roles-${Date.now()}.json`);
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    manager.stopHotReload();
    // Clean up temp files
    if (existsSync(configPath)) {
      rmSync(configPath, { force: true });
    }
    if (existsSync(rolesPath)) {
      rmSync(rolesPath, { force: true });
    }
  });

  afterAll(() => {
    // Clean up test directory
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('load', () => {
    it('should create a default config file if one does not exist', async () => {
      await manager.initialize({ configPath, rolesPath });

      expect(existsSync(configPath)).toBe(true);
      expect(manager.get('server.port')).toBe(3000);
      expect(manager.get('server.host')).toBe('0.0.0.0');
      expect(manager.get('server.logLevel')).toBe('info');
    });

    it('should persist to the exact configPath provided by callers', async () => {
      configPath = join(TEST_DIR, 'custom-location', `provided-${Date.now()}.json`);

      await manager.initialize({ configPath, rolesPath });

      expect(existsSync(configPath)).toBe(true);
      expect(JSON.parse(readFileSync(configPath, 'utf-8'))).toMatchObject({
        server: { port: 3000, host: '0.0.0.0', logLevel: 'info' },
      });

      await manager.set('server.port', 4567);

      expect(JSON.parse(readFileSync(configPath, 'utf-8'))).toMatchObject({
        server: { port: 4567, host: '0.0.0.0', logLevel: 'info' },
      });
    });

    it('should load an existing config file', async () => {
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

      writeFileSync(configPath, JSON.stringify(existingConfig, null, 2));

      await manager.initialize({ configPath, rolesPath });

      expect(manager.get('server.port')).toBe(8080);
      expect(manager.get('server.host')).toBe('localhost');
    });

    it('should throw on invalid JSON', async () => {
      writeFileSync(configPath, 'not json');

      await expect(manager.initialize({ configPath, rolesPath })).rejects.toThrow();
    });

    it('should reject explicitly invalid values instead of coercing them', async () => {
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

      writeFileSync(configPath, JSON.stringify(invalidConfig, null, 2));

      await expect(manager.initialize({ configPath, rolesPath })).rejects.toBeInstanceOf(Error);
    });

    it('should still fill defaults for missing optional fields', async () => {
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

      writeFileSync(configPath, JSON.stringify(partialConfig, null, 2));

      await manager.initialize({ configPath, rolesPath });

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

    it('should create a default roles file if one does not exist', async () => {
      await manager.initialize({ configPath, rolesPath });

      expect(existsSync(rolesPath)).toBe(true);
      expect(manager.getRoles()).toEqual([
        expect.objectContaining({ id: 'default', enabled: true }),
      ]);
      expect(JSON.parse(readFileSync(rolesPath, 'utf-8'))).toEqual([
        expect.objectContaining({ id: 'default', enabled: true }),
      ]);
    });

    it('should load an existing roles file', async () => {
      writeFileSync(rolesPath, JSON.stringify([customRole], null, 2));

      await manager.initialize({ configPath, rolesPath });

      expect(manager.getRoles()).toEqual([expect.objectContaining({ id: 'custom' })]);
    });

    it('should reject invalid roles file values', async () => {
      writeFileSync(rolesPath, JSON.stringify([{ id: 'bad', enabled: 'true' }], null, 2));

      await expect(manager.initialize({ configPath, rolesPath })).rejects.toThrow(
        /角色配置验证失败/,
      );
    });

    it('should reject duplicate role ids', async () => {
      const duplicate = { ...customRole, id: 'same' };
      writeFileSync(rolesPath, JSON.stringify([duplicate, duplicate], null, 2));

      await expect(manager.initialize({ configPath, rolesPath })).rejects.toThrow(/角色 id.*重复/);
    });
  });

  describe('path-based get/set/patch', () => {
    it('should read nested values by path', async () => {
      await manager.initialize({ configPath, rolesPath });

      expect(manager.get('server.port')).toBe(3000);
      expect(manager.get('agent.memory.compressionThreshold')).toBe(0.8);
      expect(manager.get('missing.path')).toBeUndefined();
    });

    it('should return cloned values from get and getRoles', async () => {
      await manager.initialize({ configPath, rolesPath });

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
      await manager.initialize({ configPath, rolesPath });

      await manager.set('server.authToken', 'secret-token');

      expect(manager.get('server.authToken')).toBe('secret-token');
      const fileContent = JSON.parse(readFileSync(configPath, 'utf-8')) as {
        server: { authToken?: string };
      };
      expect(fileContent.server.authToken).toBe('secret-token');
    });

    it('should patch object paths by deep merging', async () => {
      await manager.initialize({ configPath, rolesPath });

      await manager.patch('server', { authToken: 'patched-token' });

      expect(manager.get('server.port')).toBe(3000);
      expect(manager.get('server.authToken')).toBe('patched-token');
    });

    it('should replace array values as whole paths', async () => {
      await manager.initialize({ configPath, rolesPath });

      await manager.set('plugins', [{ name: 'example-plugin', enabled: false }]);

      expect(manager.get('plugins')).toEqual([{ name: 'example-plugin', enabled: false }]);
    });

    it('should reject array element paths', async () => {
      await manager.initialize({ configPath, rolesPath });

      expect(() => manager.get('mcp.0.enabled')).toThrow(/数组路径/);
      await expect(manager.set('plugins.0.enabled', false)).rejects.toThrow(/数组路径/);
    });

    it('should reject invalid set values before persisting', async () => {
      await manager.initialize({ configPath, rolesPath });

      await expect(manager.set('server.port', '3000')).rejects.toBeInstanceOf(Error);

      expect(manager.get('server.port')).toBe(3000);
      const fileContent = JSON.parse(readFileSync(configPath, 'utf-8')) as {
        server: { port: number };
      };
      expect(fileContent.server.port).toBe(3000);
    });

    it('should reject patching scalar targets', async () => {
      await manager.initialize({ configPath, rolesPath });

      await expect(manager.patch('server.port', {})).rejects.toThrow(/对象/);
    });

    it('should set roles and reject duplicate role ids', async () => {
      await manager.initialize({ configPath, rolesPath });

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
      await manager.initialize({ configPath, rolesPath });

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

      writeFileSync(configPath, JSON.stringify(existingConfig, null, 2));
      await manager.initialize({ configPath, rolesPath });

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

      writeFileSync(configPath, JSON.stringify(existingConfig, null, 2));
      await manager.initialize({ configPath, rolesPath });

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
      await manager.initialize({ configPath, rolesPath });

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
      await manager.initialize({ configPath, rolesPath });
      manager.startHotReload();
      await new Promise((resolve) => setTimeout(resolve, 100));

      const updated = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
      updated.server = { port: 7777, host: '127.0.0.1', logLevel: 'debug' };
      writeFileSync(configPath, JSON.stringify(updated, null, 2));
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(manager.get('server.port')).toBe(7777);
    });

    it('should keep previous cache on invalid hot reload changes', async () => {
      await manager.initialize({ configPath, rolesPath });
      manager.startHotReload();
      await new Promise((resolve) => setTimeout(resolve, 100));

      writeFileSync(configPath, JSON.stringify({ server: { port: 'bad' } }, null, 2));
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(manager.get('server.port')).toBe(3000);
    });
  });
});
