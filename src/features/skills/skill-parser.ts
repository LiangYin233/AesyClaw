import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../../platform/observability/logger.js';
import type { SkillMetadata } from './types.js';
import { SKILL_MANIFEST_FILE } from './types.js';

export interface ParseResult {
  success: boolean;
  metadata?: SkillMetadata;
  error?: string;
}

export async function parseSkillManifest(skillDir: string): Promise<ParseResult> {
  const manifestPath = path.join(skillDir, SKILL_MANIFEST_FILE);

  try {
    const content = await fs.readFile(manifestPath, 'utf-8');
    const metadata = extractMetadata(content, path.basename(skillDir));

    if (!metadata.name) {
      return {
        success: false,
        error: `SKILL.md missing required 'name' field in ${skillDir}`,
      };
    }

    return { success: true, metadata };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        success: false,
        error: `SKILL.md not found in ${skillDir}`,
      };
    }
    return {
      success: false,
      error: `Failed to parse SKILL.md: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function extractMetadata(content: string, defaultName: string): SkillMetadata {
  const metadata: SkillMetadata = {
    name: defaultName,
    description: '',
  };

  const yamlMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (yamlMatch) {
    const yamlContent = yamlMatch[1];
    const lines = yamlContent.split('\n');

    for (const line of lines) {
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) continue;

      const key = line.slice(0, colonIndex).trim();
      const value = line.slice(colonIndex + 1).trim();

      switch (key) {
        case 'name':
          metadata.name = value || defaultName;
          break;
        case 'version':
          metadata.version = value;
          break;
        case 'description':
          metadata.description = value;
          break;
        case 'author':
          metadata.author = value;
          break;
        case 'tags':
          metadata.tags = value ? value.split(',').map(t => t.trim()) : [];
          break;
        case 'dependencies':
          metadata.dependencies = value ? value.split(',').map(d => d.trim()) : [];
          break;
      }
    }
  }

  const descMatch = content.match(/##?\s*Description\s*\n([\s\S]*?)(?:\n##|\n---|$)/i);
  if (descMatch && !metadata.description) {
    metadata.description = descMatch[1].trim().slice(0, 200);
  }

  return metadata;
}

export async function scanSkillDirectory(dir: string): Promise<{ name: string; path: string; metadata?: SkillMetadata }[]> {
  const skills: { name: string; path: string; metadata?: SkillMetadata }[] = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillPath = path.join(dir, entry.name);
      const result = await parseSkillManifest(skillPath);

      if (result.success) {
        skills.push({
          name: result.metadata!.name,
          path: skillPath,
          metadata: result.metadata,
        });
        logger.debug({ skillName: result.metadata!.name, path: skillPath }, 'Discovered skill');
      } else {
        logger.warn({ path: skillPath, error: result.error }, 'Failed to parse skill manifest');
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.error({ dir, error }, 'Error scanning skill directory');
    }
  }

  return skills;
}
