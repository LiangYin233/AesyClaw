import path from 'node:path';
import { DIR_NAMES, FILE_NAMES } from './types';

/**
 * 从给定的根目录解析项目目录路径。
 *
 * PathResolver 是启动时第一个初始化的子系统。
 * 整个应用中的文件 I/O 必须使用 PathResolver 提供的路径 —— 禁止硬编码路径。
 */
export class PathResolver {
  private root: string = '';
  private _runtimeRoot: string = '';
  private _dataDir: string = '';
  private _configFile: string = '';
  private _dbFile: string = '';
  private _rolesDir: string = '';
  private _mediaDir: string = '';
  private _workspaceDir: string = '';
  private _skillsDir: string = '';
  private _systemSkillsDir: string = '';
  private _userSkillsDir: string = '';
  private _extensionsDir: string = '';

  /**
   * 从给定的根目录解析所有路径。
   * 必须在任何其他子系统初始化之前调用。
   */
  resolve(root: string): void {
    this.root = root;
    this._runtimeRoot = path.join(root, DIR_NAMES.runtimeRoot);
    this._dataDir = path.join(this._runtimeRoot, DIR_NAMES.data);
    this._configFile = path.join(this._runtimeRoot, FILE_NAMES.config);
    this._dbFile = path.join(this._dataDir, FILE_NAMES.database);
    this._rolesDir = path.join(this._runtimeRoot, DIR_NAMES.roles);
    this._mediaDir = path.join(this._runtimeRoot, DIR_NAMES.media);
    this._workspaceDir = path.join(this._runtimeRoot, DIR_NAMES.workspace);
    this._skillsDir = path.join(root, DIR_NAMES.skills);
    this._systemSkillsDir = path.join(root, DIR_NAMES.systemSkills);
    this._userSkillsDir = path.join(this._runtimeRoot, DIR_NAMES.userSkills);
    this._extensionsDir = path.join(root, DIR_NAMES.extensions);
  }

  get runtimeRoot(): string {
    return this._runtimeRoot;
  }

  get dataDir(): string {
    return this._dataDir;
  }

  get configFile(): string {
    return this._configFile;
  }

  get dbFile(): string {
    return this._dbFile;
  }

  get rolesDir(): string {
    return this._rolesDir;
  }

  get mediaDir(): string {
    return this._mediaDir;
  }

  get workspaceDir(): string {
    return this._workspaceDir;
  }

  /**
   * 内置 skills 目录（`<project>/skills/`）。
   * 包含随仓库分发的默认 skills 和 `system/` 子目录。
   */
  get skillsDir(): string {
    return this._skillsDir;
  }

  get systemSkillsDir(): string {
    return this._systemSkillsDir;
  }

  get extensionsDir(): string {
    return this._extensionsDir;
  }

  /**
   * 用户自定义 skills 目录（`<project>/.aesyclaw/skills/`）。
   * 运行时生成，供用户添加自定义 skills。
   */
  get userSkillsDir(): string {
    return this._userSkillsDir;
  }
}
