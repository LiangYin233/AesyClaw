import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SkillManager } from '../../src/skills/SkillManager';
import type { SkillInfo } from '../../src/skills/SkillManager';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

describe('SkillManager', () => {
  let manager: SkillManager;

  beforeEach(() => {
    manager = new SkillManager('./skills');
  });

  describe('registerSkill / getSkill / listSkills / unregisterSkill', () => {
    it('should register and retrieve a skill', () => {
      const skill: SkillInfo = {
        name: 'test',
        description: 'Test skill',
        path: '/path/to/skill',
        enabled: true
      };

      manager.registerSkill(skill);
      expect(manager.getSkill('test')).toEqual(skill);
    });

    it('should list all skills', () => {
      manager.registerSkill({
        name: 'skill1',
        description: 'First',
        path: '/path1',
        enabled: true
      });
      manager.registerSkill({
        name: 'skill2',
        description: 'Second',
        path: '/path2',
        enabled: false
      });

      const skills = manager.listSkills();
      expect(skills).toHaveLength(2);
      expect(skills.map(s => s.name).sort()).toEqual(['skill1', 'skill2']);
    });

    it('should unregister a skill', () => {
      manager.registerSkill({
        name: 'test',
        description: 'Test',
        path: '/path',
        enabled: true
      });

      manager.unregisterSkill('test');
      expect(manager.getSkill('test')).toBeUndefined();
    });

    it('should return undefined for non-existent skill', () => {
      expect(manager.getSkill('nonexistent')).toBeUndefined();
    });
  });

  describe('buildSkillsPrompt', () => {
    it('should return empty string when no skills', () => {
      expect(manager.buildSkillsPrompt()).toBe('');
    });

    it('should build prompt for enabled skills only', () => {
      manager.registerSkill({
        name: 'enabled',
        description: 'Enabled skill',
        path: '/path1',
        enabled: true
      });
      manager.registerSkill({
        name: 'disabled',
        description: 'Disabled skill',
        path: '/path2',
        enabled: false
      });

      const prompt = manager.buildSkillsPrompt();
      expect(prompt).toContain('enabled');
      expect(prompt).not.toContain('disabled');
    });

    it('should include skill names in prompt', () => {
      manager.registerSkill({
        name: 'greeting',
        description: 'Greet users',
        path: '/path',
        enabled: true
      });

      const prompt = manager.buildSkillsPrompt();
      expect(prompt).toContain('greeting');
      expect(prompt).toContain('Greet users');
    });

    it('should include file list when present', () => {
      manager.registerSkill({
        name: 'test',
        description: 'Test',
        path: '/path',
        enabled: true,
        files: [
          { name: 'SKILL.md', path: '/path/SKILL.md', isDirectory: false },
          { name: 'script.py', path: '/path/script.py', isDirectory: false }
        ]
      });

      const prompt = manager.buildSkillsPrompt();
      expect(prompt).toContain('SKILL.md');
      expect(prompt).toContain('script.py');
    });
  });

  describe('loadFromDirectory - description parsing', () => {
    let testDir: string;

    beforeEach(() => {
      testDir = join(tmpdir(), `aesyclaw-skill-test-${randomUUID().slice(0, 8)}`);
      mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
      try { rmSync(testDir, { recursive: true, force: true }); } catch {}
    });

    it('should use front matter description over body text', async () => {
      const skillDir = join(testDir, 'my-skill');
      mkdirSync(skillDir);
      writeFileSync(join(skillDir, 'SKILL.md'), [
        '---',
        'name: my-skill',
        'description: Front matter description here',
        '---',
        '',
        '# My Skill Title',
        '',
        '## 概述',
        '',
        'Body paragraph text.',
      ].join('\n'));

      const sm = new SkillManager(testDir);
      await sm.loadFromDirectory();

      const skill = sm.getSkill('my-skill');
      expect(skill).toBeDefined();
      expect(skill!.description).toBe('Front matter description here');
    });

    it('should not use sub-headings as description', async () => {
      const skillDir = join(testDir, 'sub-heading');
      mkdirSync(skillDir);
      writeFileSync(join(skillDir, 'SKILL.md'), [
        '# Title',
        '',
        '## 概述',
        '',
        'Actual description text.',
      ].join('\n'));

      const sm = new SkillManager(testDir);
      await sm.loadFromDirectory();

      const skill = sm.getSkill('sub-heading');
      expect(skill).toBeDefined();
      expect(skill!.description).not.toContain('概述');
      expect(skill!.description).toBe('Actual description text.');
    });

    it('should use body text when no front matter description', async () => {
      const skillDir = join(testDir, 'no-fm');
      mkdirSync(skillDir);
      writeFileSync(join(skillDir, 'SKILL.md'), [
        '# Simple Skill',
        '',
        'This is the body description.',
      ].join('\n'));

      const sm = new SkillManager(testDir);
      await sm.loadFromDirectory();

      const skill = sm.getSkill('no-fm');
      expect(skill).toBeDefined();
      expect(skill!.description).toBe('This is the body description.');
    });
  });
});
