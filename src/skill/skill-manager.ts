/**
 * SkillManager — 加载、存储和过滤技能定义。
 *
 * 技能是带有 YAML frontmatter 的 Markdown 文件，存储在：
 * - 系统技能: `skills/*.md`          (始终包含，不可过滤)
 * - 用户技能:   `.aesyclaw/skills/*.md` (根据角色的 `skills` 配置过滤)
 *
 * 当系统技能和用户技能同名时，系统技能
 * 优先（用户技能被忽略）。
 *
 * 角色配置按名称引用技能；管理器解析
 * 给定角色应包含哪些技能。
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

  // ─── 生命周期 ────────────────────────────────────────────────

  /**
   * 从系统目录和用户目录加载所有技能文件。
   *
   * 先加载用户技能，再加载系统技能 — 因此系统技能
   * 在名称冲突时始终优先。
   *
   * @param systemDir - `skills/` 的路径（系统技能，始终包含）
   * @param userDir   - `.aesyclaw/skills/` 的路径（用户技能，按角色过滤）
   */
  async loadAll(systemDir: string, userDir: string): Promise<void> {
    this.skills.clear();

    // 先加载用户技能，以便系统技能在冲突时优先
    this.loadFromDirectory(userDir, false);

    // 加载系统技能（在名称冲突时覆盖用户技能）
    this.loadFromDirectory(systemDir, true);

    logger.info(`已加载 ${this.skills.size} 个技能`);
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
    const systemSkills = [...this.skills.values()].filter((s) => s.isSystem);

    // 通配符：返回所有技能
    if (role.skills.length === 1 && role.skills[0] === '*') {
      return [...this.skills.values()];
    }

    // 特定列表：系统技能 + 匹配的用户技能
    const skillSet = new Set(role.skills);
    const userSkills = [...this.skills.values()].filter((s) => !s.isSystem && skillSet.has(s.name));

    return [...systemSkills, ...userSkills];
  }

  /**
   * 为系统提示词构建格式化的技能提示段落。
   *
   * 每个技能渲染为：
   * ```
   * ## Skill: {name}
   * {content}
   * ```
   *
   * 段落之间用空行连接。
   */
  buildSkillPromptSection(skills: Skill[]): string {
    return buildSkillPromptSection(skills);
  }

  // ─── 私有辅助方法 ───────────────────────────────────────────

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
