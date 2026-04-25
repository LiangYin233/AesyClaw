import path from 'node:path';
import { DIR_NAMES, FILE_NAMES } from './constants';

/**
 * Resolves project directory paths from a given root directory.
 *
 * PathResolver is the first subsystem initialised at startup.
 * All file I/O throughout the application must use paths
 * provided by PathResolver — never hardcoded paths.
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
  private _extensionsDir: string = '';

  /**
   * Resolve all paths from the given root directory.
   * Must be called before any other subsystem initialisation.
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

  get skillsDir(): string {
    return this._skillsDir;
  }

  get systemSkillsDir(): string {
    return this._systemSkillsDir;
  }

  get extensionsDir(): string {
    return this._extensionsDir;
  }
}
