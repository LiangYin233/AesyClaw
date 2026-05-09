/**
 * SkillManager — 加载、存储和过滤技能定义。
 *
 * 技能是带有 YAML frontmatter 的 Markdown 文件，存储在：
 * - 系统技能: `skills/*.md`          (始终包含，不可过滤)
 * - 用户技能:   `.aesyclaw/skills/*.md` (根据角色的 `skills` 配置过滤)
 *
 * 角色配置按名称引用技能；管理器解析
 * 给定角色应包含哪些技能。
 */

import fs from 'node:fs';
import path from 'node:path';
import { createScopedLogger } from '@aesyclaw/core/logger';
import type { Skill, RoleConfig } from '@aesyclaw/core/types';
import { parseSkillFile } from './skill-parser';

const logger = createScopedLogger('skill');

export class SkillManager {
  private skills: Map<string, Skill> = new Map();
  private lastUserDir?: string;

  /**
   * 从用户目录和系统目录加载所有技能文件。
   *
   * @param userDir   - `.aesyclaw/skills/` 的路径（用户技能，按角色过滤）
   * @param systemDir - `skills/` 的路径（系统技能，始终包含）
   */
  async loadAll(userDir: string, systemDir: string): Promise<void> {
    this.lastUserDir = userDir;
    this.skills.clear();
    this.loadFromDirectory(userDir, false);
    this.loadFromDirectory(systemDir, true);

    logger.info(`已加载 ${this.skills.size} 个技能`);
  }

  async reload(): Promise<void> {
    if (!this.lastUserDir) {
      throw new Error('技能尚未加载，无法重载');
    }
    this.removeUserSkills();
    this.loadFromDirectory(this.lastUserDir, false);
    logger.info(`已重新加载用户技能，当前共 ${this.skills.size} 个技能`);
  }

  // ─── 读取 ──────────────────────────────────────────────────────

  /** 返回所有已加载的技能（系统 + 用户）。 */
  getAllSkills(): Skill[] {
    return [...this.skills.values()];
  }

  /** 按名称获取已加载的技能。 */
  getSkill(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /**
   * 获取适用于给定角色的技能。
   *
   * - 系统技能始终包含。
   * - 如果 `role.skills` 为 `['*']`，则返回所有技能。
   * - 否则，仅包含名称在 `role.skills` 中的用户技能。
   */
  getSkillsForRole(role: RoleConfig): Skill[] {
    const isWildcard = role.skills.length === 1 && role.skills[0] === '*';
    const skillSet = isWildcard ? null : new Set(role.skills);

    const result: Skill[] = [];
    for (const skill of this.skills.values()) {
      if (skill.isSystem || isWildcard || skillSet?.has(skill.name)) {
        result.push(skill);
      }
    }
    return result;
  }

  // ─── 私有辅助方法 ───────────────────────────────────────────

  private removeUserSkills(): void {
    for (const [name, skill] of this.skills) {
      if (!skill.isSystem) {
        this.skills.delete(name);
      }
    }
  }

  /**
   * 从目录加载所有 `.md` 文件，递归进入子目录。
   *
   * @param dir      - 要扫描的目录
   * @param isSystem - 这些是否为系统技能
   */
  private loadFromDirectory(dir: string, isSystem: boolean): void {
    if (!fs.existsSync(dir)) {
      logger.debug(`技能目录不存在: ${dir}`);
      return;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      logger.warn(`读取技能目录失败: ${dir}`, err);
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
          logger.warn(`技能名称 "${skill.name}" 重复 — 覆盖之前的定义`);
        }
        this.skills.set(skill.name, skill);
      }
    }
  }
}
