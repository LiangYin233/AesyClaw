import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../../platform/observability/logger.js';
import { skillManager } from './skill-manager.js';
import type { ITool, ToolExecuteContext, ToolExecutionResult } from '../../platform/tools/types.js';
import { SKILL_MANIFEST_FILE } from './types.js';

const LoadSkillParameters = z.object({
  skill_name: z.string().describe('The name of the skill to load'),
  file_path: z.string().optional().default(SKILL_MANIFEST_FILE).describe('The file path within the skill directory to read (defaults to SKILL.md)'),
});

export class LoadSkillTool implements ITool {
  readonly name = 'load_skill';
  readonly description = 'Load a skill from the available skills library. Skills provide specialized knowledge, templates, and standard operating procedures for specific tasks. Use this when you need domain-specific expertise or structured guidance.';
  readonly parametersSchema = LoadSkillParameters;

  getDefinition() {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object' as const,
        properties: {
          skill_name: {
            type: 'string' as const,
            description: 'The name of the skill to load',
          },
          file_path: {
            type: 'string' as const,
            description: 'The file path within the skill directory to read (defaults to SKILL.md)',
          },
        },
        required: ['skill_name'],
      },
    };
  }

  async execute(args: unknown, context: ToolExecuteContext): Promise<ToolExecutionResult> {
    const { skill_name, file_path = SKILL_MANIFEST_FILE } = args as { skill_name: string; file_path?: string };

    logger.info({ skill_name, file_path, traceId: context.traceId }, 'Loading skill');

    const basePath = skillManager.getSkillBasePath(skill_name);

    if (!basePath) {
      const availableSkills = skillManager.getStats();
      const routes = skillManager.getAllRoutes();
      const availableNames = routes.map(r => r.name).join(', ') || 'none';

      logger.warn({ skill_name, availableSkills }, '⚠️ Skill not found');

      return {
        success: false,
        content: '',
        error: `Skill "${skill_name}" not found. Available skills: ${availableNames}. Use exactly one of the available skill names.`,
      };
    }

    let targetFullPath: string;
    try {
      targetFullPath = path.resolve(basePath, file_path);
    } catch (error) {
      return {
        success: false,
        content: '',
        error: `Invalid file path: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const normalizedTarget = path.normalize(targetFullPath);
    const normalizedBase = path.normalize(basePath);

    if (!normalizedTarget.startsWith(normalizedBase + path.sep) && normalizedTarget !== normalizedBase) {
      logger.error(
        { skill_name, basePath, targetFullPath, normalizedTarget, normalizedBase },
        '🚫 Directory traversal attempt blocked'
      );

      return {
        success: false,
        content: '',
        error: `Security violation: Access denied. The requested path "${file_path}" is outside the skill directory. This attempt has been logged.`,
      };
    }

    try {
      const content = await fs.readFile(targetFullPath, 'utf-8');

      const route = skillManager.getSkillRoute(skill_name);
      const source = route?.source || 'unknown';
      const skillInfo = route?.metadata ? `\n\nSkill: ${skill_name} (${source})\nVersion: ${route.metadata.version || 'N/A'}\nAuthor: ${route.metadata.author || 'N/A'}\n` : '';

      logger.info({ skill_name, file_path, source, traceId: context.traceId }, '✅ Skill loaded successfully');

      return {
        success: true,
        content: `${skillInfo}\n--- Content of ${file_path} ---\n\n${content}`,
        metadata: {
          skill_name,
          file_path,
          source,
          basePath,
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.warn({ skill_name, targetFullPath }, '⚠️ Skill file not found');

        return {
          success: false,
          content: '',
          error: `File "${file_path}" not found in skill "${skill_name}". Check if the file exists within the skill directory.`,
        };
      }

      logger.error({ skill_name, targetFullPath, error }, '❌ Failed to read skill file');

      return {
        success: false,
        content: '',
        error: `Failed to read skill file: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

export const loadSkillTool = new LoadSkillTool();
