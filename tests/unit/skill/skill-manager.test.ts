/**
 * SkillManager unit tests.
 *
 * Tests cover: loadAll, getAllSkills, getSkillsForRole (system always
 * included, wildcard, specific list), buildSkillPromptSection.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SkillManager } from '../../../src/skill/skill-manager';
import { buildSkillPromptSection } from '../../../src/skill/skill-prompt';
import type { RoleConfig, SkillDefinition } from '../../../src/core/types';

const TEST_DIR = join(tmpdir(), 'aesyclaw-test-skill-manager');

function makeRole(overrides: Partial<RoleConfig> = {}): RoleConfig {
  return {
    id: 'test-role',
    name: 'Test Role',
    description: 'A test role',
    systemPrompt: 'You are a test assistant.',
    model: 'openai/gpt-4o',
    toolPermission: { mode: 'allowlist', list: ['*'] },
    skills: ['*'],
    enabled: true,
    ...overrides,
  };
}

function expectSkill(skill: SkillDefinition | undefined, name: string): SkillDefinition {
  expect(skill).toBeDefined();
  if (skill === undefined) {
    throw new Error(`Expected skill ${name} to exist`);
  }
  return skill;
}

describe('SkillManager', () => {
  let manager: SkillManager;
  let systemDir: string;
  let userDir: string;

  beforeEach(() => {
    manager = new SkillManager();
    systemDir = join(TEST_DIR, `system-${Date.now()}`);
    userDir = join(TEST_DIR, `user-${Date.now()}`);
    mkdirSync(systemDir, { recursive: true });
    mkdirSync(userDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('loadAll', () => {
    it('should load system skills from the system directory', async () => {
      writeFileSync(
        join(systemDir, 'sys-skill.md'),
        `---
name: sys-skill
description: A system skill
---
System content.`,
      );

      await manager.loadAll(userDir, systemDir);

      const skills = manager.getAllSkills();
      expect(skills).toHaveLength(1);
      const skill = expectSkill(skills[0], 'sys-skill');
      expect(skill.name).toBe('sys-skill');
      expect(skill.isSystem).toBe(true);
    });

    it('should load user skills from the user directory', async () => {
      writeFileSync(
        join(userDir, 'user-skill.md'),
        `---
name: user-skill
description: A user skill
---
User content.`,
      );

      await manager.loadAll(userDir, systemDir);

      const skills = manager.getAllSkills();
      expect(skills).toHaveLength(1);
      const skill = expectSkill(skills[0], 'user-skill');
      expect(skill.name).toBe('user-skill');
      expect(skill.isSystem).toBe(false);
    });

    it('should load both system and user skills', async () => {
      writeFileSync(
        join(systemDir, 'system-skill.md'),
        `---
name: system-skill
description: System
---
Sys content.`,
      );

      writeFileSync(
        join(userDir, 'user-skill.md'),
        `---
name: user-skill
description: User
---
User content.`,
      );

      await manager.loadAll(userDir, systemDir);

      const skills = manager.getAllSkills();
      expect(skills).toHaveLength(2);
      expect(skills.find((s) => s.name === 'system-skill')).toBeDefined();
      expect(skills.find((s) => s.name === 'user-skill')).toBeDefined();
    });

    it('should give system skills priority over user skills on name collision', async () => {
      writeFileSync(
        join(systemDir, 'conflict.md'),
        `---
name: conflict
description: System version
---
System content.`,
      );

      writeFileSync(
        join(userDir, 'conflict.md'),
        `---
name: conflict
description: User version
---
User content.`,
      );

      await manager.loadAll(userDir, systemDir);

      const skill = manager.getSkill('conflict');
      const conflictSkill = expectSkill(skill, 'conflict');
      expect(conflictSkill.isSystem).toBe(true);
      expect(conflictSkill.description).toBe('System version');
      expect(conflictSkill.content).toBe('System content.');
    });

    it('should skip malformed skill files gracefully', async () => {
      writeFileSync(
        join(systemDir, 'valid.md'),
        `---
name: valid
description: Valid
---
Valid content.`,
      );

      writeFileSync(join(systemDir, 'malformed.md'), 'No frontmatter here');

      await manager.loadAll(userDir, systemDir);

      const skills = manager.getAllSkills();
      expect(skills).toHaveLength(1);
      expect(expectSkill(skills[0], 'valid').name).toBe('valid');
    });

    it('should handle non-existent directories gracefully', async () => {
      const nonExistentDir = join(TEST_DIR, 'nonexistent-sys');
      const nonExistentUserDir = join(TEST_DIR, 'nonexistent-user');

      await manager.loadAll(nonExistentUserDir, nonExistentDir);

      const skills = manager.getAllSkills();
      expect(skills).toHaveLength(0);
    });
  });

  describe('getSkillsForRole', () => {
    it('should always include system skills', async () => {
      writeFileSync(
        join(systemDir, 'system-skill.md'),
        `---
name: system-skill
description: System
---
Sys content.`,
      );

      await manager.loadAll(userDir, systemDir);

      const role = makeRole({ skills: [] }); // No user skills
      const skills = manager.getSkillsForRole(role);
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('system-skill');
      expect(skills[0].isSystem).toBe(true);
    });

    it('should return all skills for wildcard role', async () => {
      writeFileSync(
        join(systemDir, 'sys1.md'),
        `---
name: sys1
description: System 1
---
Sys1 content.`,
      );

      writeFileSync(
        join(userDir, 'usr1.md'),
        `---
name: usr1
description: User 1
---
Usr1 content.`,
      );

      await manager.loadAll(userDir, systemDir);

      const role = makeRole({ skills: ['*'] });
      const skills = manager.getSkillsForRole(role);
      expect(skills).toHaveLength(2);
    });

    it('should filter user skills by role skill list', async () => {
      writeFileSync(
        join(systemDir, 'system-skill.md'),
        `---
name: system-skill
description: System
---
Sys content.`,
      );

      writeFileSync(
        join(userDir, 'usr1.md'),
        `---
name: usr1
description: User 1
---
Usr1 content.`,
      );

      writeFileSync(
        join(userDir, 'usr2.md'),
        `---
name: usr2
description: User 2
---
Usr2 content.`,
      );

      await manager.loadAll(userDir, systemDir);

      const role = makeRole({ skills: ['usr2'] });
      const skills = manager.getSkillsForRole(role);

      // System skill always included + only usr2 from user skills
      expect(skills).toHaveLength(2);
      expect(skills.find((s) => s.name === 'system-skill')).toBeDefined();
      expect(skills.find((s) => s.name === 'usr2')).toBeDefined();
      expect(skills.find((s) => s.name === 'usr1')).toBeUndefined();
    });
  });

  describe('buildSkillPromptSection', () => {
    it('should format skills as prompt sections', async () => {
      writeFileSync(
        join(systemDir, 'skill1.md'),
        `---
name: skill1
description: First skill
---
First content.`,
      );

      writeFileSync(
        join(userDir, 'skill2.md'),
        `---
name: skill2
description: Second skill
---
Second content.`,
      );

      await manager.loadAll(userDir, systemDir);

      const role = makeRole({ skills: ['*'] });
      const skills = manager.getSkillsForRole(role);
      const prompt = buildSkillPromptSection(skills);

      expect(prompt).toContain('## Skill: skill1\nFirst content.');
      expect(prompt).toContain('## Skill: skill2\nSecond content.');
    });

    it('should return empty string for empty skills list', () => {
      const prompt = buildSkillPromptSection([]);
      expect(prompt).toBe('');
    });

    it('should inject system skills plus only role-allowed user skills', async () => {
      writeFileSync(
        join(systemDir, 'system-skill.md'),
        `---
name: system-skill
description: System
---
System content.`,
      );

      writeFileSync(
        join(userDir, 'allowed-skill.md'),
        `---
name: allowed-skill
description: Allowed
---
Allowed content.`,
      );

      writeFileSync(
        join(userDir, 'blocked-skill.md'),
        `---
name: blocked-skill
description: Blocked
---
Blocked content.`,
      );

      await manager.loadAll(userDir, systemDir);

      const role = makeRole({ skills: ['allowed-skill'] });
      const prompt = buildSkillPromptSection(manager.getSkillsForRole(role));

      expect(prompt).toContain('## Skill: system-skill\nSystem content.');
      expect(prompt).toContain('## Skill: allowed-skill\nAllowed content.');
      expect(prompt).not.toContain('blocked-skill');
      expect(prompt).not.toContain('Blocked content.');
    });
  });
});
