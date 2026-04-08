import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../platform/observability/logger.js';
import { pathResolver } from '../../platform/utils/paths.js';
import { scanSkillDirectory } from './skill-parser.js';
import type { SkillRoute, SkillSource, SkillMetadata } from './types.js';

export class SkillManager {
  private static instance: SkillManager | undefined;

  private routes: Map<string, SkillRoute> = new Map();
  private initialized: boolean = false;
  private watcher: fs.FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private selfUpdating: boolean = false;

  private constructor() {}

  static getInstance(): SkillManager {
    if (!SkillManager.instance) {
      SkillManager.instance = new SkillManager();
    }
    return SkillManager.instance;
  }

  static resetInstance(): void {
    if (SkillManager.instance?.watcher) {
      SkillManager.instance.watcher.close();
    }
    SkillManager.instance = undefined;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn({}, 'SkillManager already initialized');
      return;
    }

    logger.info({}, 'Initializing SkillManager...');

    await this.scanAll();

    this.setupFileWatcher();

    this.initialized = true;
    logger.info(
      { systemSkills: this.countBySource('system'), userSkills: this.countBySource('user') },
      'SkillManager initialized'
    );
  }

  private async scanAll(): Promise<void> {
    const systemDir = pathResolver.getSystemSkillsDir();
    const userDir = pathResolver.getUserSkillsDir();

    logger.info({ systemDir, userDir }, 'Scanning skill directories');

    const systemSkills = await scanSkillDirectory(systemDir);
    for (const skill of systemSkills) {
      this.registerRoute(skill.name, skill.path, 'system', skill.metadata);
    }

    const userSkills = await scanSkillDirectory(userDir);
    for (const skill of userSkills) {
      this.registerRoute(skill.name, skill.path, 'user', skill.metadata);
    }

    if (systemSkills.length > 0) {
      logger.info({ count: systemSkills.length }, 'System skills loaded');
    }
    if (userSkills.length > 0) {
      logger.info({ count: userSkills.length }, 'User skills loaded');
    }
  }

  private registerRoute(name: string, basePath: string, source: SkillSource, metadata?: SkillMetadata): void {
    const existing = this.routes.get(name);
    if (existing) {
      if (existing.source === 'user' && source === 'system') {
        logger.debug({ skillName: name }, 'User skill shadows system skill, keeping user version');
        return;
      }
    }

    this.routes.set(name, {
      name,
      shortDescription: metadata?.description || `Skill: ${name}`,
      source,
      basePath,
      metadata,
    });

    logger.debug(
      { skillName: name, source, basePath },
      existing ? 'Skill route updated (shadowed)' : 'Skill route registered'
    );
  }

  private setupFileWatcher(): void {
    if (this.watcher) return;

    const systemDir = pathResolver.getSystemSkillsDir();

    try {
      this.watcher = fs.watch(
        systemDir,
        { recursive: true },
        (eventType, filename) => {
          try {
            if (!filename) return;
            
            const fullPath = path.join(systemDir, filename);
            if (filename.endsWith('SKILL.md') || fs.existsSync(fullPath)) {
              this.handleFileChange();
            }
          } catch (error) {
            logger.debug({ eventType, filename, error }, 'Error handling file watcher event');
          }
        }
      );

      this.watcher.on('error', (error) => {
        logger.error({ error }, 'Skill directory watcher error');
      });

      logger.debug({}, 'File watcher set up for skill directories');
    } catch (error) {
      logger.warn({ error }, 'Failed to set up skill file watcher');
    }
  }

  private handleFileChange(): void {
    if (this.selfUpdating) return;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(async () => {
      await this.reload();
    }, 500);
  }

  async reload(): Promise<void> {
    this.selfUpdating = true;
    try {
      this.routes.clear();
      await this.scanAll();
      logger.info({}, 'Skill routes reloaded');
    } finally {
      this.selfUpdating = false;
    }
  }

  getSkillBasePath(name: string): string | undefined {
    return this.routes.get(name)?.basePath;
  }

  getSkillRoute(name: string): SkillRoute | undefined {
    return this.routes.get(name);
  }

  getAllRoutes(): SkillRoute[] {
    return Array.from(this.routes.values());
  }

  getSystemPromptExtension(): string {
    if (this.routes.size === 0) {
      return '';
    }

    const lines: string[] = [
      '',
      '---',
      '## Available Skills',
      '',
      'You can use the `load_skill` tool to access specialized skills for specific tasks.',
      'Available skills:',
    ];

    const systemSkills = this.getBySource('system');
    const userSkills = this.getBySource('user');

    if (systemSkills.length > 0) {
      lines.push('');
      lines.push('### System Skills');
      for (const skill of systemSkills) {
        lines.push(`- **${skill.name}**: ${skill.shortDescription}`);
      }
    }

    if (userSkills.length > 0) {
      lines.push('');
      lines.push('### User Skills');
      for (const skill of userSkills) {
        lines.push(`- **${skill.name}**: ${skill.shortDescription}`);
      }
    }

    lines.push('');
    lines.push('Use `load_skill(skill_name)` to load a skill and get its documentation.');

    return lines.join('\n');
  }

  private getBySource(source: SkillSource): SkillRoute[] {
    return Array.from(this.routes.values()).filter(r => r.source === source);
  }

  private countBySource(source: SkillSource): number {
    return this.getBySource(source).length;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getStats(): { total: number; system: number; user: number } {
    return {
      total: this.routes.size,
      system: this.countBySource('system'),
      user: this.countBySource('user'),
    };
  }

  getSkillDescriptionsForRole(allowedSkillIds: string[]): string | null {
    if (allowedSkillIds.length === 0) {
      return null;
    }

    const lines: string[] = [];

    for (const skillId of allowedSkillIds) {
      const skill = this.routes.get(skillId);
      if (skill) {
        lines.push(`- **${skill.name}**: ${skill.shortDescription}`);
      }
    }

    if (lines.length === 0) {
      return null;
    }

    lines.push('');
    lines.push('使用 `load_skill(skill_name)` 加载技能并获取详细文档。');

    return lines.join('\n');
  }

  getSkillNames(): string[] {
    return Array.from(this.routes.keys());
  }
}

export const skillManager = SkillManager.getInstance();
