import { watch, type FSWatcher } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';
import { normalizeError } from '../errors/index.js';
import { logger } from '../observability/index.js';
import type { Config } from '../types.js';
import { ConfigLoader } from '../config/loader.js';
import { formatSkillsPrompt } from './promptFormatter.js';

const SKILL_ENTRY_FILE = 'SKILL.md';
const RELOAD_DEBOUNCE_MS = 250;

export type SkillSource = 'builtin' | 'external';

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
  source: SkillSource;
  builtin: boolean;
  configurable: boolean;
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

export interface SkillReloadSummary {
  added: string[];
  updated: string[];
  removed: string[];
  total: number;
  cleanedAgentRefs: number;
}

interface SkillRootSpec {
  source: SkillSource;
  dir: string;
}

export interface SkillManagerOptions {
  builtinSkillsDir?: string;
  externalSkillsDir?: string;
}

export class SkillManager {
  private skills = new Map<string, SkillInfo>();
  private builtinSkillsDir = './skills';
  private externalSkillsDir = './workspace/skills';
  private readonly log = logger.child('SkillManager');
  private config: Config | null = null;
  private rootWatchers = new Map<string, FSWatcher>();
  private dirWatchers = new Map<string, FSWatcher>();
  private reloadTimer: NodeJS.Timeout | null = null;
  private reloadPromise: Promise<SkillReloadSummary> | null = null;
  private pendingReload = false;

  constructor(options?: SkillManagerOptions) {
    if (options?.builtinSkillsDir) {
      this.builtinSkillsDir = options.builtinSkillsDir;
    }
    if (options?.externalSkillsDir) {
      this.externalSkillsDir = options.externalSkillsDir;
    }
  }

  setConfig(config: Config): void {
    this.applyConfig(config);
  }

  applyConfig(config: Config): void {
    this.config = config;
    for (const skill of this.skills.values()) {
      skill.enabled = skill.builtin
        ? true
        : (config.skills?.[skill.name]?.enabled ?? true);
    }
  }

  async loadFromDirectory(): Promise<void> {
    const rootSpecs = this.getRootSpecs();
    for (const spec of rootSpecs) {
      await fs.mkdir(spec.dir, { recursive: true });
    }

    this.log.info('正在加载技能目录', {
      builtinDir: rootSpecs.find((spec) => spec.source === 'builtin')?.dir,
      externalDir: rootSpecs.find((spec) => spec.source === 'external')?.dir
    });

    try {
      this.skills = await this.scanAllSkillDirectories();
      if (this.config) {
        this.applyConfig(this.config);
      }
      await this.cleanupBuiltinSkillConfigEntries();
      this.log.info(`已加载 ${this.skills.size} 个技能`);
    } catch (error) {
      this.log.warn('加载技能目录失败', {
        error: normalizeError(error)
      });
    }
  }

  async startWatching(): Promise<void> {
    if (this.rootWatchers.size > 0) {
      return;
    }

    const rootSpecs = this.getRootSpecs();
    for (const spec of rootSpecs) {
      await fs.mkdir(spec.dir, { recursive: true });
      const watcher = watch(spec.dir, (_eventType, filename) => {
        this.scheduleReload(filename ? `${spec.source}:root:${filename.toString()}` : `${spec.source}:root`);
      });
      this.rootWatchers.set(spec.dir, watcher);
    }

    await this.syncDirectoryWatchers();
    this.log.info('技能目录监视器已启动', {
      builtinDir: rootSpecs.find((spec) => spec.source === 'builtin')?.dir,
      externalDir: rootSpecs.find((spec) => spec.source === 'external')?.dir
    });
  }

  async stopWatching(): Promise<void> {
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = null;
    }

    for (const watcher of this.rootWatchers.values()) {
      watcher.close();
    }
    this.rootWatchers.clear();

    for (const watcher of this.dirWatchers.values()) {
      watcher.close();
    }
    this.dirWatchers.clear();
    this.log.info('技能目录监视器已停止');
  }

  async reload(): Promise<SkillReloadSummary> {
    if (this.reloadPromise) {
      this.pendingReload = true;
      return this.reloadPromise;
    }

    this.reloadPromise = (async () => {
      let lastSummary = await this.performReload();

      while (this.pendingReload) {
        this.pendingReload = false;
        lastSummary = await this.performReload();
      }

      return lastSummary;
    })();

    try {
      return await this.reloadPromise;
    } finally {
      this.reloadPromise = null;
    }
  }

  getSkill(name: string): SkillInfo | undefined {
    return this.skills.get(name);
  }

  listSkills(): SkillInfo[] {
    return Array.from(this.skills.values());
  }

  async toggleSkill(name: string, enabled: boolean): Promise<boolean> {
    const skill = this.skills.get(name);
    if (!skill) {
      return false;
    }
    if (!skill.configurable) {
      throw new Error(`Built-in skill cannot be toggled: ${name}`);
    }

    skill.enabled = enabled;

    const nextConfig = await ConfigLoader.update((config) => {
      if (!config.skills) {
        config.skills = {};
      }
      config.skills[name] = { enabled };
    });
    this.applyConfig(nextConfig);
    this.log.info(`已将技能 ${name} 的启用状态写入配置`);

    return true;
  }

  async readSkillFile(skillName: string, fileName?: string): Promise<string | null> {
    const skill = this.skills.get(skillName);
    if (!skill) {
      return null;
    }

    const targetFileName = this.sanitizeFileName(fileName || SKILL_ENTRY_FILE);
    if (!targetFileName) {
      return 'Invalid file name';
    }

    const file = skill.files?.find((entry) => entry.name === targetFileName);
    if (!file) {
      return `File "${targetFileName}" not found in skill "${skillName}"`;
    }

    if (file.isDirectory) {
      return `"${targetFileName}" is a directory, not a file`;
    }

    try {
      return await fs.readFile(file.path, 'utf-8');
    } catch (error) {
      this.log.error(`读取技能文件失败: ${file.path}`, {
        path: file.path,
        error: normalizeError(error)
      });
      return `Failed to read file: ${error}`;
    }
  }

  async listSkillFiles(skillName: string): Promise<SkillFile[] | null> {
    const skill = this.skills.get(skillName);
    if (!skill) {
      return null;
    }
    return skill.files || [];
  }

  async getSkillContent(name: string): Promise<string | null> {
    return this.readSkillFile(name, SKILL_ENTRY_FILE);
  }

  buildSkillsPrompt(): string {
    return formatSkillsPrompt(this.listSkills().filter((skill) => skill.enabled));
  }

  private getRootSpecs(): SkillRootSpec[] {
    return [
      {
        source: 'builtin',
        dir: this.resolvePath(this.builtinSkillsDir)
      },
      {
        source: 'external',
        dir: this.resolvePath(this.externalSkillsDir)
      }
    ];
  }

  private resolvePath(dir: string): string {
    return path.isAbsolute(dir) ? dir : path.resolve(process.cwd(), dir);
  }

  private scheduleReload(reason: string): void {
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
    }

    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = null;
      void this.reload().catch((error) => {
        this.log.error('技能重载失败', {
          reason,
          error: normalizeError(error)
        });
      });
    }, RELOAD_DEBOUNCE_MS);
  }

  private async performReload(): Promise<SkillReloadSummary> {
    for (const spec of this.getRootSpecs()) {
      await fs.mkdir(spec.dir, { recursive: true });
    }

    const previousSkills = this.skills;
    const nextSkills = await this.scanAllSkillDirectories();
    this.skills = nextSkills;
    if (this.config) {
      this.applyConfig(this.config);
    }

    await this.cleanupBuiltinSkillConfigEntries();
    await this.syncDirectoryWatchers();

    const summary = this.buildReloadSummary(previousSkills, nextSkills);
    const cleanedAgentRefs = summary.removed.length > 0
      ? await this.cleanupRemovedSkillReferences(summary.removed)
      : 0;

    const result: SkillReloadSummary = {
      ...summary,
      cleanedAgentRefs
    };

    this.log.info('技能已重载', {
      added: result.added,
      updated: result.updated,
      removed: result.removed,
      total: result.total,
      cleanedAgentRefs: result.cleanedAgentRefs
    });
    return result;
  }

  private buildReloadSummary(previousSkills: Map<string, SkillInfo>, nextSkills: Map<string, SkillInfo>): SkillReloadSummary {
    const previousNames = new Set(previousSkills.keys());
    const nextNames = new Set(nextSkills.keys());

    const added = Array.from(nextNames).filter((name) => !previousNames.has(name)).sort();
    const removed = Array.from(previousNames).filter((name) => !nextNames.has(name)).sort();
    const updated = Array.from(nextNames)
      .filter((name) => previousNames.has(name))
      .filter((name) => this.skillFingerprint(previousSkills.get(name)!) !== this.skillFingerprint(nextSkills.get(name)!))
      .sort();

    return {
      added,
      updated,
      removed,
      total: nextSkills.size,
      cleanedAgentRefs: 0
    };
  }

  private skillFingerprint(skill: SkillInfo): string {
    const files = [...(skill.files || [])]
      .map((file) => ({
        name: file.name,
        path: file.path,
        isDirectory: file.isDirectory
      }))
      .sort((left, right) => left.name.localeCompare(right.name));

    return JSON.stringify({
      name: skill.name,
      description: skill.description,
      path: skill.path,
      content: skill.content,
      enabled: skill.enabled,
      source: skill.source,
      builtin: skill.builtin,
      configurable: skill.configurable,
      files
    });
  }

  private async scanAllSkillDirectories(): Promise<Map<string, SkillInfo>> {
    const merged = new Map<string, SkillInfo>();

    for (const spec of this.getRootSpecs()) {
      const skillMap = await this.scanSkillDirectory(spec);
      for (const [name, skill] of skillMap.entries()) {
        if (merged.has(name)) {
          const existing = merged.get(name)!;
          this.log.warn('检测到重复 skill 名称，已保留优先项', {
            skill: name,
            keptSource: existing.source,
            ignoredSource: skill.source
          });
          continue;
        }
        merged.set(name, skill);
      }
    }

    return new Map([...merged.entries()].sort(([left], [right]) => left.localeCompare(right)));
  }

  private async scanSkillDirectory(spec: SkillRootSpec): Promise<Map<string, SkillInfo>> {
    const skillMap = new Map<string, SkillInfo>();
    const entries = await fs.readdir(spec.dir, { withFileTypes: true });

    await Promise.all(entries.map(async (entry) => {
      if (!entry.isDirectory() || entry.name.startsWith('.')) {
        return;
      }

      const skillPath = path.join(spec.dir, entry.name);
      const skill = await this.loadSkillDirectory(skillPath, entry.name, spec.source);
      if (skill) {
        skillMap.set(entry.name, skill);
      }
    }));

    return new Map([...skillMap.entries()].sort(([left], [right]) => left.localeCompare(right)));
  }

  private async loadSkillDirectory(skillPath: string, name: string, source: SkillSource): Promise<SkillInfo | null> {
    try {
      const skillMdPath = path.join(skillPath, SKILL_ENTRY_FILE);
      const content = await fs.readFile(skillMdPath, 'utf-8');
      const { description } = this.parseSkillFile(content);
      const files = await this.getSkillFilesList(skillPath);
      const builtin = source === 'builtin';
      const enabled = builtin
        ? true
        : (this.config?.skills?.[name]?.enabled ?? true);

      return {
        name,
        description: description || '',
        path: skillMdPath,
        files,
        content,
        enabled,
        source,
        builtin,
        configurable: !builtin
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        this.log.warn(`加载技能失败: ${name}`, {
          skill: name,
          source,
          error: normalizeError(error)
        });
      }
      return null;
    }
  }

  private async getSkillFilesList(skillPath: string): Promise<SkillFile[]> {
    const files: SkillFile[] = [];

    try {
      const entries = await fs.readdir(skillPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) {
          continue;
        }

        files.push({
          name: entry.name,
          path: path.join(skillPath, entry.name),
          isDirectory: entry.isDirectory()
        });
      }
    } catch (error) {
      this.log.warn(`列出技能文件失败: ${skillPath}`, {
        path: skillPath,
        error: normalizeError(error)
      });
    }

    return files.sort((left, right) => left.name.localeCompare(right.name));
  }

  private parseSkillFile(content: string): { description: string; metadata: Record<string, string> } {
    const parsed = matter(content);
    const metadata = Object.fromEntries(
      Object.entries(parsed.data).map(([key, value]) => [key, this.normalizeFrontMatterValue(value)])
    );

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

  private normalizeFrontMatterValue(value: unknown): string {
    if (typeof value === 'string') {
      return value.trim();
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.normalizeFrontMatterValue(item)).join('\n');
    }

    if (value === null || value === undefined) {
      return '';
    }

    if (typeof value === 'object') {
      return JSON.stringify(value);
    }

    return String(value);
  }

  private sanitizeFileName(fileName: string): string {
    const normalized = path.normalize(fileName);
    if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
      return '';
    }
    return normalized;
  }

  private async syncDirectoryWatchers(): Promise<void> {
    const nextDirectories = new Set<string>();

    for (const spec of this.getRootSpecs()) {
      const entries = await fs.readdir(spec.dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) {
          continue;
        }
        nextDirectories.add(path.join(spec.dir, entry.name));
      }
    }

    for (const [dirPath, watcher] of this.dirWatchers.entries()) {
      if (nextDirectories.has(dirPath)) {
        continue;
      }
      watcher.close();
      this.dirWatchers.delete(dirPath);
    }

    for (const dirPath of nextDirectories) {
      if (this.dirWatchers.has(dirPath)) {
        continue;
      }

      try {
        const watcher = watch(dirPath, (_eventType, filename) => {
          this.scheduleReload(filename ? `dir:${filename.toString()}` : `dir:${path.basename(dirPath)}`);
        });
        this.dirWatchers.set(dirPath, watcher);
      } catch (error) {
        this.log.warn('监视技能目录失败', {
          path: dirPath,
          error: normalizeError(error)
        });
      }
    }
  }

  private async cleanupRemovedSkillReferences(removedSkills: string[]): Promise<number> {
    const removedSet = new Set(removedSkills);
    let cleanedAgentRefs = 0;

    const nextConfig = await ConfigLoader.update((config) => {
      const prune = (allowedSkills: string[] = []): string[] => {
        const nextAllowedSkills = allowedSkills.filter((name) => !removedSet.has(name));
        cleanedAgentRefs += allowedSkills.length - nextAllowedSkills.length;
        return nextAllowedSkills;
      };

      for (const role of Object.values(config.agents.roles)) {
        role.allowedSkills = prune(role.allowedSkills);
      }

      for (const removedSkill of removedSkills) {
        delete config.skills[removedSkill];
      }
    });

    this.applyConfig(nextConfig);
    return cleanedAgentRefs;
  }

  private async cleanupBuiltinSkillConfigEntries(): Promise<void> {
    if (!this.config) {
      return;
    }

    const builtinSkillNames = Array.from(this.skills.values())
      .filter((skill) => skill.builtin)
      .map((skill) => skill.name);
    if (builtinSkillNames.length === 0) {
      return;
    }

    const staleNames = builtinSkillNames.filter((name) => this.config?.skills?.[name]);
    if (staleNames.length === 0) {
      return;
    }

    const nextConfig = await ConfigLoader.update((config) => {
      for (const name of staleNames) {
        delete config.skills[name];
      }
    });
    this.applyConfig(nextConfig);
  }
}
