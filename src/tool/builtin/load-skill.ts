/**
 * Built-in load_skill tool.
 *
 * Reads a text file from inside a loaded skill's dedicated directory.
 *
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { Static } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';
import type { Skill } from '../../core/types';
import type { ToolOwner } from '../../core/types';
import type { SkillManager } from '../../skill/skill-manager';
import type { AesyClawTool, ToolExecutionContext, ToolExecutionResult } from '../tool-registry';

const LoadSkillParamsSchema = Type.Object({
  skillName: Type.String({ description: '要读取的技能名称' }),
  relativePath: Type.Optional(
    Type.String({ description: '技能目录内的相对文件路径，默认 SKILL.md' }),
  ),
});

type LoadSkillParams = Static<typeof LoadSkillParamsSchema>;

export interface LoadSkillDeps {
  skillManager: Pick<SkillManager, 'getSkill'>;
}

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

export function createLoadSkillTool(deps: LoadSkillDeps): AesyClawTool {
  return {
    name: 'load_skill',
    description: '读取已加载技能目录中的文本文件',
    parameters: LoadSkillParamsSchema,
    owner: 'system' as ToolOwner,
    execute: async (
      params: unknown,
      _context: ToolExecutionContext,
    ): Promise<ToolExecutionResult> => {
      const { skillName, relativePath: rawRelativePath } = params as LoadSkillParams;
      const relativePath = rawRelativePath ?? 'SKILL.md';
      const skill = deps.skillManager.getSkill(skillName);

      if (!skill) {
        return errorResult(
          `Skill "${skillName}" is not loaded.`,
          'SKILL_NOT_FOUND',
          skillName,
          relativePath,
        );
      }

      const skillRoot = getDedicatedSkillRoot(skill);
      if (!skillRoot) {
        return errorResult(
          `Skill "${skillName}" has no dedicated directory context.`,
          'SKILL_HAS_NO_DIRECTORY_CONTEXT',
          skillName,
          relativePath,
        );
      }

      if (path.isAbsolute(relativePath)) {
        return errorResult(
          `Path "${relativePath}" must be relative to skill "${skillName}".`,
          'SKILL_PATH_TRAVERSAL_REJECTED',
          skillName,
          relativePath,
        );
      }

      const requestedPath = path.resolve(skillRoot, relativePath);
      if (!isPathInsideRoot(skillRoot, requestedPath)) {
        return errorResult(
          `Path "${relativePath}" escapes skill "${skillName}" directory.`,
          'SKILL_PATH_TRAVERSAL_REJECTED',
          skillName,
          relativePath,
        );
      }

      let stat;
      try {
        stat = await fs.stat(requestedPath);
      } catch (error: unknown) {
        if (isNodeError(error, 'ENOENT')) {
          return errorResult(
            `File "${relativePath}" does not exist in skill "${skillName}".`,
            'SKILL_FILE_NOT_FOUND',
            skillName,
            relativePath,
          );
        }

        return errorResult(
          `Could not access file "${relativePath}" in skill "${skillName}": ${getErrorMessage(error)}`,
          'SKILL_FILE_UNREADABLE',
          skillName,
          relativePath,
        );
      }

      if (!stat.isFile()) {
        return errorResult(
          `Path "${relativePath}" in skill "${skillName}" is not a file.`,
          'SKILL_FILE_UNREADABLE',
          skillName,
          relativePath,
        );
      }

      try {
        const realRoot = await fs.realpath(skillRoot);
        const realPath = await fs.realpath(requestedPath);

        if (!isPathInsideRoot(realRoot, realPath)) {
          return errorResult(
            `Path "${relativePath}" escapes skill "${skillName}" directory.`,
            'SKILL_PATH_TRAVERSAL_REJECTED',
            skillName,
            relativePath,
          );
        }

        const buffer = await fs.readFile(realPath);
        const content = decodeUtf8Text(buffer);
        return { content };
      } catch (error: unknown) {
        if (error instanceof NonTextFileError) {
          return errorResult(
            `File "${relativePath}" in skill "${skillName}" is not a readable UTF-8 text file.`,
            'SKILL_FILE_NOT_TEXT',
            skillName,
            relativePath,
          );
        }

        return errorResult(
          `Could not read file "${relativePath}" in skill "${skillName}": ${getErrorMessage(error)}`,
          'SKILL_FILE_UNREADABLE',
          skillName,
          relativePath,
        );
      }
    },
  };
}

function getDedicatedSkillRoot(skill: Skill): string | null {
  return path.basename(skill.filePath) === 'SKILL.md' ? path.dirname(skill.filePath) : null;
}

function isPathInsideRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function decodeUtf8Text(buffer: Buffer): string {
  if (buffer.includes(0)) {
    throw new NonTextFileError();
  }

  try {
    return utf8Decoder.decode(buffer);
  } catch {
    throw new NonTextFileError();
  }
}

function errorResult(
  content: string,
  code:
    | 'SKILL_NOT_FOUND'
    | 'SKILL_HAS_NO_DIRECTORY_CONTEXT'
    | 'SKILL_PATH_TRAVERSAL_REJECTED'
    | 'SKILL_FILE_NOT_FOUND'
    | 'SKILL_FILE_UNREADABLE'
    | 'SKILL_FILE_NOT_TEXT',
  skillName: string,
  relativePath: string,
): ToolExecutionResult {
  return {
    content,
    isError: true,
    details: { code, skillName, relativePath },
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code;
}

class NonTextFileError extends Error {
  constructor() {
    super('Not a UTF-8 text file');
    this.name = 'NonTextFileError';
  }
}
