/** RoleManager unit tests for ConfigManager-backed roles. */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConfigManager } from '../../../src/core/config/config-manager';
import type { RoleConfig } from '../../../src/core/types';
import { RoleManager } from '../../../src/role/role-manager';

const TEST_BASE = join(tmpdir(), 'aesyclaw-test-role-manager');

function makeRole(overrides: Partial<RoleConfig> = {}): RoleConfig {
  return {
    id: 'default',
    description: 'A default role',
    systemPrompt: 'You are an assistant.',
    model: 'openai/gpt-4o',
    toolPermission: { mode: 'allowlist', list: ['*'] },
    skills: ['*'],
    enabled: true,
    ...overrides,
  };
}

describe('RoleManager', () => {
  let testRoot: string;
  let configManager: ConfigManager;
  let manager: RoleManager;

  beforeEach(async () => {
    testRoot = join(TEST_BASE, `test-${Date.now()}`);
    mkdirSync(testRoot, { recursive: true });
    configManager = new ConfigManager(testRoot);
    manager = new RoleManager();
  });

  afterEach(() => {
    configManager.stopHotReload();
    manager.destroy();
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  async function initializeWithRoles(roles: RoleConfig[]): Promise<void> {
    await configManager.setRoles(roles);
    await manager.initialize({ configManager });
  }

  describe('initialize', () => {
    it('loads roles from ConfigManager', async () => {
      await initializeWithRoles([makeRole({ id: 'test-role' })]);

      expect(manager.getAllRoles()).toHaveLength(1);
      expect(manager.getRole('test-role').id).toBe('test-role');
    });

    it('always treats the default role as enabled', async () => {
      await initializeWithRoles([makeRole({ id: 'default', enabled: false })]);

      expect(manager.getRole('default').enabled).toBe(true);
      expect(manager.getDefaultRole().enabled).toBe(true);
    });
  });

  describe('getRole', () => {
    it('returns the role by ID', async () => {
      await initializeWithRoles([makeRole({ id: 'my-role' })]);

      expect(manager.getRole('my-role').id).toBe('my-role');
    });

    it('falls back to default role when ID is not found', async () => {
      await initializeWithRoles([makeRole({ id: 'default' })]);

      expect(manager.getRole('nonexistent').id).toBe('default');
    });
  });

  describe('getDefaultRole', () => {
    it('returns the role with id default', async () => {
      await initializeWithRoles([makeRole({ id: 'default' }), makeRole({ id: 'other' })]);

      expect(manager.getDefaultRole().id).toBe('default');
    });

    it('returns the first enabled role when no default exists', async () => {
      await initializeWithRoles([makeRole({ id: 'alpha' }), makeRole({ id: 'beta' })]);

      expect(manager.getDefaultRole().id).toBe('alpha');
    });

    it('throws when no roles are available', async () => {
      await initializeWithRoles([]);

      expect(() => manager.getDefaultRole()).toThrow();
    });
  });

  describe('getEnabledRoles', () => {
    it('returns only enabled roles', async () => {
      await initializeWithRoles([
        makeRole({ id: 'enabled1', enabled: true }),
        makeRole({ id: 'disabled', enabled: false }),
        makeRole({ id: 'enabled2', enabled: true }),
      ]);

      const enabled = manager.getEnabledRoles();
      expect(enabled).toHaveLength(2);
      expect(enabled.every((role) => role.enabled)).toBe(true);
    });
  });

  describe('saveRole', () => {
    it('updates roles through ConfigManager', async () => {
      await initializeWithRoles([makeRole({ id: 'tracked', description: 'Old' })]);

      await manager.saveRole('tracked', makeRole({ id: 'tracked', description: 'Updated' }));

      expect(manager.getRole('tracked').description).toBe('Updated');
      expect(configManager.getRoles()[0]?.description).toBe('Updated');
    });
  });

  describe('createRole', () => {
    it('creates a role through ConfigManager', async () => {
      await initializeWithRoles([makeRole({ id: 'default' })]);

      const created = await manager.createRole({
        id: 'created',
        description: 'Created role',
        systemPrompt: 'Hello',
        model: 'openai/gpt-4o',
        toolPermission: { mode: 'allowlist', list: [] },
        skills: [],
        enabled: true,
      });

      expect(created.id).toBe('created');
      expect(manager.getRole('created').id).toBe('created');
      expect(configManager.getRoles().map((role) => role.id)).toContain('created');
    });
  });

  describe('deleteRole', () => {
    it('deletes a role through ConfigManager', async () => {
      await initializeWithRoles([makeRole({ id: 'default' }), makeRole({ id: 'temporary' })]);

      await manager.deleteRole('temporary');

      expect(manager.getAllRoles().map((role) => role.id)).not.toContain('temporary');
      expect(configManager.getRoles().map((role) => role.id)).not.toContain('temporary');
    });

    it('rejects deleting the default role', async () => {
      await initializeWithRoles([makeRole({ id: 'default' })]);

      await expect(manager.deleteRole('default')).rejects.toThrow('默认角色不可删除');
    });
  });

  describe('on-demand role reading', () => {
    it('reads latest roles from ConfigManager on demand', async () => {
      await configManager.setRoles([makeRole({ id: 'first' })]);
      await manager.initialize({ configManager });

      expect(manager.getAllRoles().map((role) => role.id)).toEqual(['first']);

      await configManager.setRoles([makeRole({ id: 'second' })]);

      expect(manager.getAllRoles().map((role) => role.id)).toEqual(['second']);
    });
  });
});
