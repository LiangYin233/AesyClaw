/**
 * 内置 load_skill 工具。
 *
 * 从已加载技能的专用目录中读取文本文件。
 *
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { Type } from '@sinclair/typebox';
import type { Skill } from '@aesyclaw/core/types';
import type { ToolOwner } from '@aesyclaw/core/types';
import type { SkillManager } from '@aesyclaw/skill/skill-manager';
import { errorMessage } from '@aesyclaw/core/utils';
import type {
  AesyClawTool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '@aesyclaw/tool/tool-registry';

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

const LOAD_SKILL_SCHEMA = Type.Object({
  skillName: Type.String({ description: '要读取的技能名称' }),
  relativePath: Type.Optional(
    Type.String({ description: '技能目录内的相对文件路径，默认 SKILL.md' }),
  ),
});

export function createLoadSkillTool(deps: {
  skillManager: Pick<SkillManager, 'getSkill'>;
}): AesyClawTool {
  return {
    name: 'load_skill',
    description: '读取技能',
    parameters: LOAD_SKILL_SCHEMA,
    owner: 'system' as ToolOwner,
    execute: async (
      params: unknown,
      _context: ToolExecutionContext,
    ): Promise<ToolExecutionResult> => {
      const { skillName, relativePath: rawRelativePath } = params as {
        skillName: string;
        relativePath?: string;
      };
      const relativePath = rawRelativePath ?? 'SKILL.md';
      const skill = deps.skillManager.getSkill(skillName);

      if (!skill) {
        return errorResult(
          `技能 "${skillName}" 未加载。`,
          'SKILL_NOT_FOUND',
          skillName,
          relativePath,
        );
      }

      const skillRoot = getDedicatedSkillRoot(skill);
      if (!skillRoot) {
        return errorResult(
          `技能 "${skillName}" 没有专用目录上下文。`,
          'SKILL_HAS_NO_DIRECTORY_CONTEXT',
          skillName,
          relativePath,
        );
      }

      if (path.isAbsolute(relativePath)) {
        return errorResult(
          `路径 "${relativePath}" 必须相对于技能 "${skillName}"。`,
          'SKILL_PATH_TRAVERSAL_REJECTED',
          skillName,
          relativePath,
        );
      }

      const requestedPath = path.resolve(skillRoot, relativePath);
      if (!isPathInsideRoot(skillRoot, requestedPath)) {
        return errorResult(
          `路径 "${relativePath}" 逃逸出技能 "${skillName}" 目录。`,
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
            `文件 "${relativePath}" 在技能 "${skillName}" 中不存在。`,
            'SKILL_FILE_NOT_FOUND',
            skillName,
            relativePath,
          );
        }

        return errorResult(
          `无法访问技能 "${skillName}" 中的文件 "${relativePath}": ${errorMessage(error)}`,
          'SKILL_FILE_UNREADABLE',
          skillName,
          relativePath,
        );
      }

      if (!stat.isFile()) {
        return errorResult(
          `技能 "${skillName}" 中的路径 "${relativePath}" 不是文件。`,
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
            `路径 "${relativePath}" 逃逸出技能 "${skillName}" 目录。`,
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
            `技能 "${skillName}" 中的文件 "${relativePath}" 不是可读的 UTF-8 文本文件。`,
            'SKILL_FILE_NOT_TEXT',
            skillName,
            relativePath,
          );
        }

        return errorResult(
          `无法读取技能 "${skillName}" 中的文件 "${relativePath}": ${errorMessage(error)}`,
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

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code;
}

class NonTextFileError extends Error {
  constructor() {
    super('不是 UTF-8 文本文件');
    this.name = 'NonTextFileError';
  }
}
