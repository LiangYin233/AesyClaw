/**
 * RoleManager unit tests.
 *
 * Tests cover: loadAll, getRole (found, fallback), getDefaultRole,
 * getEnabledRoles, buildSystemPrompt (template vars, tool list, skill section).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RoleManager } from '../../../src/role/role-manager';
import type { RoleConfig } from '../../../src/core/types';
import type { AesyClawTool } from '../../../src/tool/tool-registry';
import type { TSchema } from '@sinclair/typebox';
import type { Skill } from '../../../src/core/types';

const TEST_DIR = join(tmpdir(), 'aesyclaw-test-role-manager');

function makeRole(overrides: Partial<RoleConfig> = {}): RoleConfig {
  return {
    id: 'default',
    name: 'Default',
    description: 'A default role',
    systemPrompt: 'You are an assistant.',
    model: 'openai/gpt-4o',
    toolPermission: { mode: 'allowlist', list: ['*'] },
    skills: ['*'],
    enabled: true,
    ...overrides,
  };
}

function makeTool(overrides: Partial<AesyClawTool> = {}): AesyClawTool {
  return {
    name: 'test-tool',
    description: 'A test tool',
    parameters: {} as TSchema,
    owner: 'system',
    execute: async () => ({ content: 'test' }),
    ...overrides,
  };
}

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    name: 'test-skill',
    description: 'A test skill',
    content: 'Skill content here.',
    isSystem: true,
    filePath: '/test/skill.md',
    ...overrides,
  };
}

describe('RoleManager', () => {
  let manager: RoleManager;
  let rolesDir: string;

  beforeEach(() => {
    manager = new RoleManager();
    rolesDir = join(TEST_DIR, `roles-${Date.now()}`);
    mkdirSync(rolesDir, { recursive: true });
  });

  afterEach(() => {
    manager.stopWatching();
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('loadAll', () => {
    it('should load valid role JSON files', async () => {
      const roleData = makeRole({ id: 'test-role' });
      writeFileSync(join(rolesDir, 'test-role.json'), JSON.stringify(roleData, null, 2));

      await manager.loadAll(rolesDir);

      expect(manager.getAllRoles()).toHaveLength(1);
      expect(manager.getRole('test-role').id).toBe('test-role');
    });

    it('should skip non-JSON files', async () => {
      const roleData = makeRole({ id: 'test-role' });
      writeFileSync(join(rolesDir, 'test-role.json'), JSON.stringify(roleData, null, 2));
      writeFileSync(join(rolesDir, 'readme.txt'), 'Not a role file');

      await manager.loadAll(rolesDir);

      expect(manager.getAllRoles()).toHaveLength(1);
    });

    it('should skip invalid JSON files gracefully', async () => {
      writeFileSync(join(rolesDir, 'bad.json'), 'not valid json');

      await manager.loadAll(rolesDir);

      expect(manager.getAllRoles()).toHaveLength(0);
    });

    it('should skip role files that fail schema validation', async () => {
      // toolPermission.mode must be 'allowlist' | 'denylist', not 'invalid'
      const invalidRole = {
        id: 'invalid',
        name: 'Invalid',
        description: 'Bad tool permission mode',
        systemPrompt: 'Hello',
        model: 'openai/gpt-4o',
        toolPermission: { mode: 'invalid', list: [] },
        skills: ['*'],
        enabled: true,
      };
      writeFileSync(join(rolesDir, 'invalid.json'), JSON.stringify(invalidRole, null, 2));

      await manager.loadAll(rolesDir);

      expect(manager.getAllRoles()).toHaveLength(0);
    });

    it('should skip roles with explicitly invalid values instead of coercing them', async () => {
      const invalidRole = {
        id: 'invalid-enabled',
        name: 'Invalid Enabled',
        description: 'Bad enabled field',
        systemPrompt: 'Hello',
        model: 'openai/gpt-4o',
        toolPermission: { mode: 'allowlist', list: [123] },
        skills: ['*'],
        enabled: 'true',
      };
      writeFileSync(join(rolesDir, 'invalid-enabled.json'), JSON.stringify(invalidRole, null, 2));

      await manager.loadAll(rolesDir);

      expect(manager.getAllRoles()).toHaveLength(0);
    });

    it('should apply defaults (e.g. enabled: true)', async () => {
      const roleData = {
        id: 'no-enabled',
        name: 'No Enabled Field',
        description: 'Should default to enabled',
        systemPrompt: 'Hello',
        model: 'openai/gpt-4o',
        toolPermission: { mode: 'allowlist', list: [] },
        skills: ['*'],
        // Note: no "enabled" field
      };
      writeFileSync(join(rolesDir, 'no-enabled.json'), JSON.stringify(roleData, null, 2));

      await manager.loadAll(rolesDir);

      const roles = manager.getAllRoles();
      expect(roles).toHaveLength(1);
      expect(roles[0].enabled).toBe(true);
    });

    it('should always load the default role as enabled', async () => {
      const roleData = makeRole({ id: 'default', enabled: false });
      writeFileSync(join(rolesDir, 'default.json'), JSON.stringify(roleData, null, 2));

      await manager.loadAll(rolesDir);

      expect(manager.getRole('default').enabled).toBe(true);
      expect(manager.getDefaultRole().enabled).toBe(true);
    });

    it('should handle non-existent directory gracefully', async () => {
      const nonexistent = join(TEST_DIR, 'nonexistent-roles');
      // Don't create the directory — it should not throw

      await manager.loadAll(nonexistent);

      expect(manager.getAllRoles()).toHaveLength(0);
    });
  });

  describe('getRole', () => {
    it('should return the role by ID', async () => {
      const roleData = makeRole({ id: 'my-role', name: 'My Role' });
      writeFileSync(join(rolesDir, 'my-role.json'), JSON.stringify(roleData, null, 2));

      await manager.loadAll(rolesDir);

      const role = manager.getRole('my-role');
      expect(role.id).toBe('my-role');
    });

    it('should fall back to default role when ID not found', async () => {
      const defaultRole = makeRole({ id: 'default', name: 'Default Role' });
      writeFileSync(join(rolesDir, 'default.json'), JSON.stringify(defaultRole, null, 2));

      await manager.loadAll(rolesDir);

      const role = manager.getRole('nonexistent');
      expect(role.id).toBe('default');
    });
  });

  describe('getDefaultRole', () => {
    it('should return the role with id "default"', async () => {
      const defaultRole = makeRole({ id: 'default', name: 'Default' });
      const otherRole = makeRole({ id: 'other', name: 'Other' });
      writeFileSync(join(rolesDir, 'default.json'), JSON.stringify(defaultRole, null, 2));
      writeFileSync(join(rolesDir, 'other.json'), JSON.stringify(otherRole, null, 2));

      await manager.loadAll(rolesDir);

      const role = manager.getDefaultRole();
      expect(role.id).toBe('default');
    });

    it('should return the first enabled role when no default exists', async () => {
      const role1 = makeRole({ id: 'alpha', name: 'Alpha' });
      const role2 = makeRole({ id: 'beta', name: 'Beta' });
      writeFileSync(join(rolesDir, 'alpha.json'), JSON.stringify(role1, null, 2));
      writeFileSync(join(rolesDir, 'beta.json'), JSON.stringify(role2, null, 2));

      await manager.loadAll(rolesDir);

      const role = manager.getDefaultRole();
      expect(['alpha', 'beta']).toContain(role.id);
    });

    it('should throw when no roles are available', async () => {
      await manager.loadAll(rolesDir);

      expect(() => manager.getDefaultRole()).toThrow();
    });
  });

  describe('getEnabledRoles', () => {
    it('should return only enabled roles', async () => {
      const enabled1 = makeRole({ id: 'enabled1', name: 'Enabled 1', enabled: true });
      const disabled = makeRole({ id: 'disabled', name: 'Disabled', enabled: false });
      const enabled2 = makeRole({ id: 'enabled2', name: 'Enabled 2', enabled: true });
      writeFileSync(join(rolesDir, 'enabled1.json'), JSON.stringify(enabled1, null, 2));
      writeFileSync(join(rolesDir, 'disabled.json'), JSON.stringify(disabled, null, 2));
      writeFileSync(join(rolesDir, 'enabled2.json'), JSON.stringify(enabled2, null, 2));

      await manager.loadAll(rolesDir);

      const enabled = manager.getEnabledRoles();
      expect(enabled).toHaveLength(2);
      expect(enabled.every((r) => r.enabled)).toBe(true);
    });
  });

  describe('buildSystemPrompt', () => {
    it('should replace template variables', async () => {
      const role = makeRole({
        id: 'test',
        systemPrompt: 'Date: {{date}}, OS: {{os}}, Lang: {{systemLang}}',
      });

      const prompt = manager.buildSystemPrompt(role, [], [], []);
      expect(prompt).toMatch(/\d{4}-\d{2}-\d{2}/); // date
      expect(prompt).toContain(process.platform);
      expect(prompt).toContain(process.env.LANG ?? 'unknown');
    });

    it('should append tool list section', () => {
      const role = makeRole({ id: 'test' });
      const tools: AesyClawTool[] = [
        makeTool({ name: 'send-msg', description: 'Send a message' }),
        makeTool({ name: 'search', description: 'Search the web' }),
      ];

      const prompt = manager.buildSystemPrompt(role, tools, [], []);
      expect(prompt).toContain('## Available Tools');
      expect(prompt).toContain('**send-msg**: Send a message');
      expect(prompt).toContain('**search**: Search the web');
    });

    it('should append skill section', () => {
      const role = makeRole({ id: 'test' });
      const skills: Skill[] = [
        makeSkill({ name: 'coding', content: 'Help write code.' }),
        makeSkill({ name: 'greeting', content: 'Say hello.' }),
      ];

      const prompt = manager.buildSystemPrompt(role, [], skills, []);
      expect(prompt).toContain('## Skill: coding');
      expect(prompt).toContain('Help write code.');
      expect(prompt).toContain('## Skill: greeting');
      expect(prompt).toContain('Say hello.');
    });

    it('should append available roles section', () => {
      const role = makeRole({ id: 'test' });
      const allRoles: RoleConfig[] = [
        makeRole({ id: 'default', name: 'Default', description: 'Default assistant' }),
        makeRole({ id: 'coder', name: 'Coder', description: 'Code-focused assistant' }),
      ];

      const prompt = manager.buildSystemPrompt(role, [], [], allRoles);
      expect(prompt).toContain('## Available Roles');
      expect(prompt).toContain('**default**: Default');
      expect(prompt).toContain('**coder**: Coder');
    });

    it('should build complete prompt with all sections', () => {
      const role = makeRole({
        id: 'test',
        systemPrompt: 'You are AesyClaw. Date: {{date}}',
      });
      const tools: AesyClawTool[] = [makeTool({ name: 'run-code', description: 'Execute code' })];
      const skills: Skill[] = [makeSkill({ name: 'analysis', content: 'Analyze data.' })];
      const allRoles: RoleConfig[] = [
        makeRole({ id: 'default', name: 'Default', description: 'Default role' }),
      ];

      const prompt = manager.buildSystemPrompt(role, tools, skills, allRoles);

      expect(prompt).toContain('You are AesyClaw.');
      expect(prompt).toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(prompt).toContain('## Available Tools');
      expect(prompt).toContain('## Skill: analysis');
      expect(prompt).toContain('## Available Roles');
    });
  });
});
