/**
 * SkillManager — loads, stores, and filters skill definitions.
 *
 * Skills are Markdown files with YAML frontmatter, stored in:
 * - System skills: `skills/system/*.md`  (always included)
 * - User skills:  `skills/*.md`           (excluded: `skills/system/`)
 *
 * Role configs reference skills by name; the manager resolves which
 * skills to include for a given role.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createScopedLogger } from '../core/logger';
import type { Skill, RoleConfig } from '../core/types';
import { parseSkillFile } from './skill-parser';

const logger = createScopedLogger('skill');

export class SkillManager {
  private skills: Map<string, Skill> = new Map();

  // ─── Lifecycle ────────────────────────────────────────────────

  /**
   * Load all skill files from system and user directories.
   *
   * @param systemDir - Path to `skills/system/`
   * @param userDir   - Path to `skills/` (the `system/` subdirectory is excluded)
   */
  async loadAll(systemDir: string, userDir: string): Promise<void> {
    this.skills.clear();

    // Load system skills
    this.loadFromDirectory(systemDir, true);

    // Load user skills (excluding system/ subdirectory)
    this.loadFromDirectory(userDir, false, ['system']);

    logger.info(`Loaded ${this.skills.size} skills`);
  }

  // ─── Read ──────────────────────────────────────────────────────

  /** Return all loaded skills (system + user). */
  getAllSkills(): Skill[] {
    return [...this.skills.values()];
  }

  /**
   * Get skills applicable to a given role.
   *
   * - System skills are always included.
   * - If `role.skills` is `['*']`, all skills are returned.
   * - Otherwise, only user skills whose names are in `role.skills` are included.
   */
  getSkillsForRole(role: RoleConfig): Skill[] {
    const systemSkills = [...this.skills.values()].filter((s) => s.isSystem);

    // Wildcard: return all skills
    if (role.skills.length === 1 && role.skills[0] === '*') {
      return [...this.skills.values()];
    }

    // Specific list: system skills + matching user skills
    const skillSet = new Set(role.skills);
    const userSkills = [...this.skills.values()].filter(
      (s) => !s.isSystem && skillSet.has(s.name),
    );

    return [...systemSkills, ...userSkills];
  }

  /**
   * Build a formatted skill prompt section for the system prompt.
   *
   * Each skill is rendered as:
   * ```
   * ## Skill: {name}
   * {content}
   * ```
   *
   * Sections are joined with blank lines.
   */
  buildSkillPromptSection(skills: Skill[]): string {
    if (skills.length === 0) {
      return '';
    }

    return skills
      .map((skill) => `## Skill: ${skill.name}\n${skill.content}`)
      .join('\n\n');
  }

  // ─── Private helpers ───────────────────────────────────────────

  /**
   * Load all `.md` files from a directory.
   *
   * @param dir        - Directory to scan
   * @param isSystem   - Whether these are system skills
   * @param excludeSubs - Subdirectory names to skip (e.g. ['system'] for user dir)
   */
  private loadFromDirectory(dir: string, isSystem: boolean, excludeSubs: string[] = []): void {
    if (!fs.existsSync(dir)) {
      logger.debug(`Skill directory does not exist: ${dir}`);
      return;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      logger.warn(`Failed to read skill directory: ${dir}`, err);
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Skip excluded subdirectories
        if (excludeSubs.includes(entry.name)) {
          continue;
        }
        // Recurse into other subdirectories
        this.loadFromDirectory(fullPath, isSystem, excludeSubs);
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith('.md')) {
        continue;
      }

      const skill = parseSkillFile(fullPath, isSystem);
      if (skill) {
        if (this.skills.has(skill.name)) {
          logger.warn(`Duplicate skill name "${skill.name}" — overriding previous definition`);
        }
        this.skills.set(skill.name, skill);
      }
    }
  }
}