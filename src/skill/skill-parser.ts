/**
 * SkillParser — Parses Markdown skill files with YAML frontmatter.
 *
 * Uses the `front-matter` package to extract YAML frontmatter and
 * the Markdown body. The parser requires a `name` field in the
 * frontmatter and treats everything after the closing `---` as the
 * skill content.
 *
 * Malformed files are handled gracefully: a warning is logged and
 * `null` is returned so the caller can skip them.
 */

import fs from 'node:fs';
import fm, { type FrontMatterResult } from 'front-matter';
import { createScopedLogger } from '../core/logger';
import type { Skill } from '../core/types';

const logger = createScopedLogger('skill');

/** Result of a successful skill file parse */
export interface ParsedSkill {
  name: string;
  description: string;
  content: string;
}

/**
 * Parse a Markdown skill file with YAML frontmatter.
 *
 * @param filePath - Absolute path to the .md file
 * @param isSystem - Whether this is a system skill
 * @returns Parsed skill object, or `null` if the file is malformed
 */
export function parseSkillFile(filePath: string, isSystem: boolean): Skill | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = parseSkillContent(raw);

    if (!parsed) {
      logger.warn(`Skipping malformed skill file: ${filePath}`);
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
    logger.warn(`Failed to read skill file: ${filePath}`, err);
    return null;
  }
}

/**
 * Parse raw Markdown content with YAML frontmatter using `front-matter`.
 *
 * @param content - Raw file content
 * @returns Parsed data, or `null` if frontmatter is missing or invalid
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

  if (!isRecord(attributes) || typeof attributes.name !== 'string' || attributes.name === '') {
    return null;
  }

  const description = typeof attributes.description === 'string' ? attributes.description : '';

  return {
    name: attributes.name,
    description,
    content: body.trim(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}