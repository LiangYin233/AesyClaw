import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../observability/logger.js';

const AESYCCLAW_DIR = '.aesyclaw';
const DEFAULT_DATA_DIR = 'data';
const DEFAULT_LOG_DIR = 'logs';
const DEFAULT_CONFIG_FILE = 'config.json';
const DEFAULT_DATA_FILE = 'aesyclaw.db';
const DEFAULT_LOG_FILE = 'aesyclaw.log';
const DEFAULT_SYSTEM_SKILLS_DIR = 'skills';
const DEFAULT_USER_SKILLS_DIR = 'user_skills';
const DEFAULT_WORKSPACE_DIR = 'workspace';
const DEFAULT_MEDIA_DIR = 'media';
const DEFAULT_ROLES_DIR = 'roles';

export class PathResolver {
  private basePath: string;
  private configDir: string;
  private dataDir: string;
  private logDir: string;
  private systemSkillsDir: string;
  private userSkillsDir: string;
  private workspaceDir: string;
  private mediaDir: string;
  private rolesDir: string;
  private initialized: boolean = false;

  constructor() {
    this.basePath = path.join(process.cwd(), AESYCCLAW_DIR);
    this.configDir = this.basePath;
    this.dataDir = path.join(this.basePath, DEFAULT_DATA_DIR);
    this.logDir = path.join(this.basePath, DEFAULT_LOG_DIR);
    this.systemSkillsDir = path.join(process.cwd(), DEFAULT_SYSTEM_SKILLS_DIR);
    this.userSkillsDir = path.join(this.basePath, DEFAULT_USER_SKILLS_DIR);
    this.workspaceDir = path.join(this.basePath, DEFAULT_WORKSPACE_DIR);
    this.mediaDir = path.join(this.basePath, DEFAULT_MEDIA_DIR);
    this.rolesDir = path.join(this.basePath, DEFAULT_ROLES_DIR);
  }

  initialize(): void {
    if (this.initialized) {
      return;
    }

    try {
      this.ensureDirectoryExists(this.basePath);
      this.ensureDirectoryExists(this.configDir);
      this.ensureDirectoryExists(this.dataDir);
      this.ensureDirectoryExists(this.logDir);
      this.ensureDirectoryExists(this.userSkillsDir);
      this.ensureDirectoryExists(this.workspaceDir);
      this.ensureDirectoryExists(this.mediaDir);
      this.ensureDirectoryExists(this.rolesDir);

      this.initialized = true;
      logger.info({
        basePath: this.basePath,
        configDir: this.configDir,
        dataDir: this.dataDir,
        logDir: this.logDir,
        systemSkillsDir: this.systemSkillsDir,
        userSkillsDir: this.userSkillsDir,
        mediaDir: this.mediaDir,
        rolesDir: this.rolesDir,
      }, 'PathResolver initialized');
    } catch (error) {
      logger.error({ error }, 'Failed to initialize PathResolver');
      throw error;
    }
  }

  public ensureDirectoryExists(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      logger.info({ path: dirPath }, 'Created directory');
    }
  }

  getBasePath(): string {
    return this.basePath;
  }

  getConfigDir(): string {
    return this.configDir;
  }

  getDataDir(): string {
    return this.dataDir;
  }

  getLogDir(): string {
    return this.logDir;
  }

  getConfigFilePath(): string {
    return path.join(this.basePath, DEFAULT_CONFIG_FILE);
  }

  getDataFilePath(): string {
    return path.join(this.dataDir, DEFAULT_DATA_FILE);
  }

  getLogFilePath(): string {
    return path.join(this.logDir, DEFAULT_LOG_FILE);
  }

  getSystemSkillsDir(): string {
    return this.systemSkillsDir;
  }

  getUserSkillsDir(): string {
    return this.userSkillsDir;
  }

  getWorkspaceDir(): string {
    return this.workspaceDir;
  }

  getMediaDir(): string {
    return this.mediaDir;
  }

  getRolesDir(): string {
    return this.rolesDir;
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}

export const pathResolver = new PathResolver();
