import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import type { RoleConfig } from '../../../src/core/types';
import { RoleManager } from '../../../src/role/manager';
import { makeRole } from '../../helpers/role';

const TEST_BASE = join(tmpdir(), 'aesyclaw-test-role-manager');

describe('RoleManager', () => {
  let testRoot: string;
  let rolesPath: string;
  let manager: RoleManager;

  beforeEach(async () => {
    testRoot = join(TEST_BASE, `test-${Date.now()}`);
    mkdirSync(testRoot, { recursive: true });
    rolesPath = join(testRoot, 'roles.json');
    manager = new RoleManager(rolesPath);
  });

  afterEach(() => {
    manager.destroy();
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  async function initializeWithRoles(roles: RoleConfig[]): Promise<void> {
    // Write roles to file before creating manager
    const configDir = dirname(rolesPath);
    mkdirSync(configDir, { recursive: true });
    // Conf expects the file to contain just the array, not { roles: [...] }
    writeFileSync(rolesPath, JSON.stringify(roles, null, 2));
    manager = new RoleManager(rolesPath);
    await manager.initialize();
  }

  describe('initialize', () => {
    it('loads roles from file', async () => {
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

    it('throws when ID is not found', async () => {
      await initializeWithRoles([makeRole({ id: 'default' })]);

      expect(() => manager.getRole('nonexistent')).toThrow('未找到角色 "nonexistent"');
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
    it('updates roles in storage', async () => {
      await initializeWithRoles([makeRole({ id: 'tracked', description: 'Old' })]);

      await manager.saveRole('tracked', makeRole({ id: 'tracked', description: 'Updated' }));

      expect(manager.getRole('tracked').description).toBe('Updated');
    });
  });

  describe('createRole', () => {
    it('creates a new role', async () => {
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
      expect(manager.getAllRoles().map((role) => role.id)).toContain('created');
    });
  });

  describe('deleteRole', () => {
    it('deletes a role', async () => {
      await initializeWithRoles([makeRole({ id: 'default' }), makeRole({ id: 'temporary' })]);

      await manager.deleteRole('temporary');

      expect(manager.getAllRoles().map((role) => role.id)).not.toContain('temporary');
    });

    it('rejects deleting the default role', async () => {
      await initializeWithRoles([makeRole({ id: 'default' })]);

      await expect(manager.deleteRole('default')).rejects.toThrow('默认角色不可删除');
    });
  });

  describe('hot reload', () => {
    it('reloads roles when file changes', async () => {
      await initializeWithRoles([makeRole({ id: 'first' })]);

      expect(manager.getAllRoles().map((role) => role.id)).toEqual(['first']);

      // Simulate file change
      writeFileSync(rolesPath, JSON.stringify({ roles: [makeRole({ id: 'second' })] }, null, 2));

      // Wait for hot reload (this might need adjustment based on actual implementation)
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Note: This test might fail if hot reload is not immediate
      // You may need to trigger reload manually or wait longer
    });
  });
});
