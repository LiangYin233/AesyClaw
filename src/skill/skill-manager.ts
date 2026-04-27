/**
 * SkillManager — loads, stores, and filters skill definitions.
 *
 * Skills are Markdown files with YAML frontmatter, stored in:
 * - System skills: `skills/*.md`          (always included, not filterable)
 * - User skills:   `.aesyclaw/skills/*.md` (filtered by role `skills` config)
 *
 * When a system and user skill share the same name, the system skill
 * takes priority (user skill is ignored).
 *
 * Role configs reference skills by name; the manager resolves which
 * skills to include for a given role.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createScopedLogger } from '../core/logger';
import type { Skill, RoleConfig } from '../core/types';
import { parseSkillFile } from './skill-parser';
import { buildSkillPromptSection } from './skill-prompt';

const logger = createScopedLogger('skill');

export class SkillManager {
  private skills: Map<string, Skill> = new Map();

  // ─── Lifecycle ────────────────────────────────────────────────

  /**
   * Load all skill files from system and user directories.
   *
   * User skills are loaded first, then system skills — so system skills
   * always take priority on name collision.
   *
   * @param systemDir - Path to `skills/` (system, always included)
   * @param userDir   - Path to `.aesyclaw/skills/` (user, filtered by role)
   */
  async loadAll(systemDir: string, userDir: string): Promise<void> {
    this.skills.clear();

    // Load user skills first so system skills take priority on conflict
    this.loadFromDirectory(userDir, false);

    // Load system skills (wins over user skills on name collision)
    this.loadFromDirectory(systemDir, true);

    logger.info(`Loaded ${this.skills.size} skills`);
  }

  // ─── Read ──────────────────────────────────────────────────────

  /** Return all loaded skills (system + user). */
  getAllSkills(): Skill[] {
    return [...this.skills.values()];
  }

  /** Get a loaded skill by name. */
  getSkill(name: string): Skill | undefined {
    return this.skills.get(name);
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
    const userSkills = [...this.skills.values()].filter((s) => !s.isSystem && skillSet.has(s.name));

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
    return buildSkillPromptSection(skills);
  }

  // ─── Private helpers ───────────────────────────────────────────

  /**
   * Load all `.md` files from a directory, recursing into subdirectories.
   *
   * @param dir      - Directory to scan
   * @param isSystem - Whether these are system skills
   */
  private loadFromDirectory(dir: string, isSystem: boolean): void {
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
        this.loadFromDirectory(fullPath, isSystem);
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
