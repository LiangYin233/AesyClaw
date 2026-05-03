/**
 * SkillParser — 解析带有 YAML frontmatter 的 Markdown 技能文件。
 *
 * 使用 `front-matter` 包提取 YAML frontmatter 和
 * Markdown 正文。解析器要求 frontmatter 中包含 `name` 字段，
 * 并将结束符 `---` 之后的所有内容视为技能内容。
 *
 * 格式错误的文件会被优雅处理：记录警告并
 * 返回 `null`，以便调用者跳过它们。
 */

import fs from 'node:fs';
import fm, { type FrontMatterResult } from 'front-matter';
import { createScopedLogger } from '@aesyclaw/core/logger';
import type { Skill } from '@aesyclaw/core/types';
import { isRecord } from '@aesyclaw/core/utils';

const logger = createScopedLogger('skill');

/** 成功解析技能文件的结果 */
export type ParsedSkill = {
  name: string;
  description: string;
  content: string;
};

/**
 * 解析带有 YAML frontmatter 的 Markdown 技能文件。
 *
 * @param filePath - .md 文件的绝对路径
 * @param isSystem - 这是否为系统技能
 * @returns 解析后的技能对象，如果文件格式错误则返回 `null`
 */
export function parseSkillFile(filePath: string, isSystem: boolean): Skill | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = parseSkillContent(raw);

    if (!parsed) {
      logger.warn(`跳过格式错误的技能文件: ${filePath}`);
      return null;
    }

    return {
      name: parsed.name,
      description: parsed.description,
      content: parsed.content,
      isSystem,
      filePath,
    };
  } catch (err) {
    logger.warn(`读取技能文件失败: ${filePath}`, err);
    return null;
  }
}

/**
 * 使用 `front-matter` 解析带有 YAML frontmatter 的原始 Markdown 内容。
 *
 * @param content - 原始文件内容
 * @returns 解析后的数据，如果 frontmatter 缺失或无效则返回 `null`
 */
export function parseSkillContent(content: string): ParsedSkill | null {
  if (!fm.test(content)) {
    return null;
  }

  let parsed: FrontMatterResult<Record<string, unknown>>;
  try {
    parsed = fm<Record<string, unknown>>(content);
  } catch {
    return null;
  }

  const { attributes, body } = parsed;

  if (
    !isRecord(attributes) ||
    typeof attributes['name'] !== 'string' ||
    attributes['name'] === ''
  ) {
    return null;
  }

  const description =
    typeof attributes['description'] === 'string' ? attributes['description'] : '';

  return {
    name: attributes['name'],
    description,
    content: body.trim(),
  };
}
