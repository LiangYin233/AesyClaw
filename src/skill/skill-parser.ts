/**
 * SkillParser — Parses Markdown skill files with YAML frontmatter.
 *
 * Frontmatter is delimited by `---` at the top of the file.
 * The parser extracts `name` and `description` from the frontmatter
 * and treats everything after the closing `---` as the skill content.
 *
 * Malformed files are handled gracefully: a warning is logged and
 * `null` is returned so the caller can skip them.
 */

import fs from 'node:fs';
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
 * Expected format:
 * ```
 * ---
 * name: My Skill
 * description: A description of the skill
 * ---
 * Skill content goes here...
 * ```
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
 * Parse raw Markdown content with YAML frontmatter.
 *
 * Uses a line-based approach: finds the opening `---` line,
 * then searches for the closing `---` line. Everything between
 * is frontmatter; everything after is the skill body.
 *
 * @param content - Raw file content
 * @returns Parsed data, or `null` if frontmatter is missing or invalid
 */
export function parseSkillContent(content: string): ParsedSkill | null {
  const lines = content.split('\n');

  // Must have at least an opening --- and a closing ---
  if (lines.length < 2) {
    return null;
  }

  // Opening delimiter must be exactly ---
  if (lines[0].trim() !== '---') {
    return null;
  }

  // Find the closing --- (must be on its own line)
  let closingLineIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      closingLineIndex = i;
      break;
    }
  }

  if (closingLineIndex === -1) {
    return null;
  }

  // Extract frontmatter lines (between the two --- delimiters)
  const frontmatterLines = lines.slice(1, closingLineIndex);
  const frontmatterText = frontmatterLines.join('\n').trim();

  // Extract body (everything after the closing ---)
  const bodyLines = lines.slice(closingLineIndex + 1);
  const body = bodyLines.join('\n').trim();

  const parsed = parseSimpleYaml(frontmatterText);
  if (!parsed) {
    return null;
  }

  // Name is required
  if (!parsed.name) {
    return null;
  }

  return {
    name: parsed.name,
    description: parsed.description ?? '',
    content: body,
  };
}

/**
 * Simple YAML parser that handles flat key: value pairs.
 * Only string values are supported (no nested objects or arrays).
 *
 * @param yaml - Raw YAML text (frontmatter content)
 * @returns Object with parsed key-value pairs, or `null` if parsing fails
 */
function parseSimpleYaml(yaml: string): Record<string, string> | null {
  if (yaml === '') {
    return null;
  }

  const result: Record<string, string> = {};

  for (const line of yaml.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }

    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) {
      // Not a valid key: value line, skip
      continue;
    }

    const key = trimmed.slice(0, colonIndex).trim();
    const value = trimmed.slice(colonIndex + 1).trim();

    if (!key) {
      continue;
    }

    // Strip surrounding quotes if present
    const unquoted = stripQuotes(value);
    result[key] = unquoted;
  }

  return result;
}

/**
 * Strip surrounding single or double quotes from a string value.
 */
function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}