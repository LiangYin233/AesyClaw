import fs from 'fs/promises';
import path from 'path';
import { logger } from '../logger/index.js';
import type { Config } from '../types.js';
import { ConfigLoader } from '../config/loader.js';

export interface SkillFile {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
  files?: SkillFile[];
  content?: string;
  enabled: boolean;
}

export interface SkillContext {
  message: string;
  senderId: string;
  chatId: string;
  channel: string;
  media?: string[];
  sessionKey?: string;
  raw?: any;
}

export interface SkillResult {
  content: string;
  media?: string[];
  consumed?: boolean;
}

export class SkillManager {
  private skills: Map<string, SkillInfo> = new Map();
  private skillsDir: string = './skills';
  private log = logger.child({ prefix: 'SkillManager' });
  private config: Config | null = null;

  constructor(skillsDir?: string) {
    if (skillsDir) {
      this.skillsDir = skillsDir;
    }
  }

  setConfig(config: Config): void {
    this.config = config;
  }

  async loadFromDirectory(dir?: string): Promise<void> {
    const skillsPath = dir || this.skillsDir;
    // 转换为绝对路径
    const absolutePath = path.isAbsolute(skillsPath) ? skillsPath : path.resolve(process.cwd(), skillsPath);
    this.log.info(`Loading skills from: ${absolutePath}`);

    try {
      const entries = await fs.readdir(absolutePath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const skillPath = path.join(absolutePath, entry.name);
        await this.loadSkillDirectory(skillPath, entry.name, absolutePath);
      }
      this.log.info(`Loaded ${this.skills.size} skills`);
    } catch (error) {
      this.log.warn(`Failed to load skills from ${absolutePath}:`, error);
    }
  }

  private async loadSkillDirectory(skillPath: string, name: string, basePath: string): Promise<void> {
    try {
      // 查找 SKILL.md 文件
      const skillMdPath = path.join(skillPath, 'SKILL.md');

      let content = '';
      try {
        content = await fs.readFile(skillMdPath, 'utf-8');
      } catch {
        this.log.debug(`No SKILL.md found for skill: ${name}`);
        return;
      }

      const { description, metadata } = this.parseSkillFile(content);
      const files = await this.getSkillFilesList(skillPath, basePath);

      // 从配置中读取 enabled 状态，默认 true
      const skillConfig = this.config?.skills?.[name];
      const enabled = skillConfig?.enabled ?? true;

      this.skills.set(name, {
        name,
        description: description || '',
        path: skillMdPath,
        files,
        content,
        enabled
      });

      this.log.debug(`Loaded skill: ${name} with ${files.length} files, enabled: ${enabled}`);
    } catch (error) {
      this.log.warn(`Failed to load skill ${name}:`, error);
    }
  }

  private async getSkillFilesList(skillPath: string, basePath: string): Promise<SkillFile[]> {
    const files: SkillFile[] = [];

    try {
      const entries = await fs.readdir(skillPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;

        files.push({
          name: entry.name,
          path: path.join(skillPath, entry.name),
          isDirectory: entry.isDirectory()
        });
      }
    } catch (error) {
      this.log.warn(`Failed to list files in ${skillPath}:`, error);
    }

    return files;
  }

  private parseSkillFile(content: string): { description: string; metadata: Record<string, string> } {
    const frontMatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const metadata: Record<string, string> = {};

    if (frontMatterMatch) {
      // 使用更健壮的方式解析 front matter
      const frontMatterLines = frontMatterMatch[1].split('\n');
      let currentKey = '';

      for (const line of frontMatterLines) {
        // 检查是否是列表项或空行
        if (line.startsWith('  - ') || line.startsWith('- ')) {
          // 多行值，继续添加到上一个 key
          if (currentKey) {
            metadata[currentKey] += '\n' + line.trim();
          }
          continue;
        }

        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
          currentKey = line.substring(0, colonIndex).trim();
          const value = line.substring(colonIndex + 1).trim();
          metadata[currentKey] = value;
        }
      }
    }

    let description = '';
    const lines = content.split('\n');
    let inDescription = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('# ')) {
        inDescription = true;
        continue;
      }
      if (trimmed.startsWith('#')) {
        continue;
      }
      if (inDescription && trimmed) {
        description = trimmed;
        break;
      }
    }

    return { description: metadata.description || description, metadata };
  }

  private sanitizeFileName(fileName: string): string {
    // 防止路径遍历攻击
    const normalized = path.normalize(fileName);
    if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
      return '';
    }
    return normalized;
  }

  getSkill(name: string): SkillInfo | undefined {
    return this.skills.get(name);
  }

  listSkills(): SkillInfo[] {
    return Array.from(this.skills.values());
  }

  async toggleSkill(name: string, enabled: boolean): Promise<boolean> {
    const skill = this.skills.get(name);
    if (!skill) return false;

    skill.enabled = enabled;

    // 持久化到 config.yaml
    if (this.config) {
      if (!this.config.skills) {
        this.config.skills = {};
      }
      this.config.skills[name] = { enabled };
      await ConfigLoader.save(this.config);
      this.log.info(`Saved skill ${name} enabled state to config`);
    }

    return true;
  }

  /**
   * 读取 skill 目录下指定文件的内容
   */
  async readSkillFile(skillName: string, fileName?: string): Promise<string | null> {
    const skill = this.skills.get(skillName);
    if (!skill) {
      return null;
    }

    const targetFileName = this.sanitizeFileName(fileName || 'SKILL.md');
    if (!targetFileName) {
      return 'Invalid file name';
    }

    const file = skill.files?.find(f => f.name === targetFileName);
    if (!file) {
      return `File "${targetFileName}" not found in skill "${skillName}"`;
    }

    if (file.isDirectory) {
      return `"${targetFileName}" is a directory, not a file`;
    }

    try {
      const content = await fs.readFile(file.path, 'utf-8');
      return content;
    } catch (error) {
      this.log.error(`Failed to read skill file ${file.path}:`, error);
      return `Failed to read file: ${error}`;
    }
  }

  /**
   * 获取 skill 目录下所有文件的列表
   */
  async listSkillFiles(skillName: string): Promise<SkillFile[] | null> {
    const skill = this.skills.get(skillName);
    if (!skill) {
      return null;
    }
    return skill.files || [];
  }

  async getSkillContent(name: string): Promise<string | null> {
    return this.readSkillFile(name, 'SKILL.md');
  }

  buildSkillsPrompt(): string {
    const skills = this.listSkills().filter(s => s.enabled);
    if (skills.length === 0) {
      return '';
    }

    const skillsList = skills.map(s => {
      const desc = s.description || 'No description';
      const filesInfo = s.files?.map(f => `  - ${f.name}${f.isDirectory ? '/' : ''}`).join('\n') || '';
      return `- **${s.name}**: ${desc}\n${filesInfo}`;
    }).join('\n\n');

    const skillNames = skills.map(s => s.name).join(', ');

    return (
      '## Skills\n\n' +
      '你可以使用 specialized skills 来完成特定任务。每个 skill 目录下可能包含多个文件。\n\n' +
      '### 可用 skills\n\n' +
      skillsList + '\n\n' +
      '### 使用方法\n\n' +
      '1. 使用 `read_skill` 工具读取 skill 文件。例如：\n' +
      '   - 读取 SKILL.md: `{"name": "greeting"}`\n' +
      '   - 读取其他文件: `{"name": "greeting", "file": "script.py"}`\n' +
      '2. 使用 `list_skill_files` 工具列出 skill 目录下的所有文件。\n\n' +
      `可用 skill: ${skillNames}`
    );
  }

  registerSkill(skill: SkillInfo): void {
    this.skills.set(skill.name, skill);
  }

  unregisterSkill(name: string): void {
    this.skills.delete(name);
  }
}
