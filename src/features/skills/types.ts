export type SkillSource = 'system' | 'user';

export interface SkillMetadata {
  name: string;
  version?: string;
  description?: string;
  author?: string;
  tags?: string[];
  dependencies?: string[];
}

export interface SkillRoute {
  name: string;
  shortDescription: string;
  source: SkillSource;
  basePath: string;
  metadata?: SkillMetadata;
}

export interface SkillConfig {
  enabled: boolean;
  systemDir?: string;
  userDir?: string;
  autoReload?: boolean;
}

export const DEFAULT_SYSTEM_SKILLS_DIR = 'skills';
export const DEFAULT_USER_SKILLS_DIR = '.aesyclaw/skills';
export const SKILL_MANIFEST_FILE = 'SKILL.md';
