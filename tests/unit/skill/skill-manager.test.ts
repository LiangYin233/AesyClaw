/**
 * SkillManager unit tests.
 *
 * Tests cover: loadAll, getAllSkills, getSkillsForRole (system always
 * included, wildcard, specific list).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SkillManager } from '../../../src/skill/skill-manager';
import type { SkillDefinition } from '../../../src/core/types';
import { makeRole } from '../../helpers/role';

const TEST_DIR = join(tmpdir(), 'aesyclaw-test-skill-manager');

function writeSkill(baseDir: string, name: string, content: string): void {
  mkdirSync(join(baseDir, name), { recursive: true });
  writeFileSync(join(baseDir, name, 'SKILL.md'), content);
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
      writeSkill(
        systemDir,
        'sys-skill',
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
      writeSkill(
        userDir,
        'user-skill',
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
      writeSkill(
        systemDir,
        'system-skill',
        `---
name: system-skill
description: System
---
Sys content.`,
      );

      writeSkill(
        userDir,
        'user-skill',
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
      writeSkill(
        systemDir,
        'conflict',
        `---
name: conflict
description: System version
---
System content.`,
      );

      writeSkill(
        userDir,
        'conflict',
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
      writeSkill(
        systemDir,
        'valid',
        `---
name: valid
description: Valid
---
Valid content.`,
      );

      mkdirSync(join(systemDir, 'malformed'), { recursive: true });
      writeFileSync(join(systemDir, 'malformed', 'SKILL.md'), 'No frontmatter here');

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
      writeSkill(
        systemDir,
        'system-skill',
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
      writeSkill(
        systemDir,
        'sys1',
        `---
name: sys1
description: System 1
---
Sys1 content.`,
      );

      writeSkill(
        userDir,
        'usr1',
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
      writeSkill(
        systemDir,
        'system-skill',
        `---
name: system-skill
description: System
---
Sys content.`,
      );

      writeSkill(
        userDir,
        'usr1',
        `---
name: usr1
description: User 1
---
Usr1 content.`,
      );

      writeSkill(
        userDir,
        'usr2',
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
});
