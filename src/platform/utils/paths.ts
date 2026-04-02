import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../observability/logger.js';

const AESYCCLAW_DIR_NAME = '.aesyclaw';
const DEFAULT_CONFIG_FILE = 'config.toml';
const DEFAULT_DATA_FILE = 'aesyclaw.db';
const DEFAULT_LOG_FILE = 'aesyclaw.log';

export class PathResolver {
  private static instance: PathResolver;
  private basePath: string;
  private configDir: string;
  private dataDir: string;
  private logDir: string;
  private initialized: boolean = false;

  private constructor() {
    this.basePath = this.resolveBasePath();
    this.configDir = path.join(this.basePath, 'config');
    this.dataDir = path.join(this.basePath, 'data');
    this.logDir = path.join(this.basePath, 'logs');
  }

  static getInstance(): PathResolver {
    if (!PathResolver.instance) {
      PathResolver.instance = new PathResolver();
    }
    return PathResolver.instance;
  }

  private resolveBasePath(): string {
    const homeDir = process.env.HOME || process.env.USERPROFILE || process.cwd();
    return path.join(homeDir, AESYCCLAW_DIR_NAME);
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

      this.initialized = true;
      logger.info({
        basePath: this.basePath,
        configDir: this.configDir,
        dataDir: this.dataDir,
        logDir: this.logDir,
      }, 'PathResolver initialized');
    } catch (error) {
      logger.error({ error }, 'Failed to initialize PathResolver');
      throw error;
    }
  }

  private ensureDirectoryExists(dirPath: string): void {
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
    return path.join(this.configDir, DEFAULT_CONFIG_FILE);
  }

  getDataFilePath(): string {
    return path.join(this.dataDir, DEFAULT_DATA_FILE);
  }

  getLogFilePath(): string {
    return path.join(this.logDir, DEFAULT_LOG_FILE);
  }

  getTempDir(): string {
    const tempDir = path.join(this.basePath, 'temp');
    this.ensureDirectoryExists(tempDir);
    return tempDir;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  reset(): void {
    this.initialized = false;
    PathResolver.instance = new PathResolver();
  }
}

export const pathResolver = PathResolver.getInstance();
