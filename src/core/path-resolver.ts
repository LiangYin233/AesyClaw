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
  private _dataDir: string = '';
  private _configFile: string = '';
  private _dbFile: string = '';
  private _rolesDir: string = '';
  private _skillsDir: string = '';
  private _systemSkillsDir: string = '';
  private _extensionDir: string = '';

  /**
   * Resolve all paths from the given root directory.
   * Must be called before any other subsystem initialisation.
   */
  resolve(root: string): void {
    this.root = root;
    this._dataDir = path.join(root, DIR_NAMES.data);
    this._configFile = path.join(root, FILE_NAMES.config);
    this._dbFile = path.join(root, DIR_NAMES.data, FILE_NAMES.database);
    this._rolesDir = path.join(root, DIR_NAMES.roles);
    this._skillsDir = path.join(root, DIR_NAMES.skills);
    this._systemSkillsDir = path.join(root, DIR_NAMES.systemSkills);
    this._extensionDir = path.join(root, DIR_NAMES.extension);
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

  get skillsDir(): string {
    return this._skillsDir;
  }

  get systemSkillsDir(): string {
    return this._systemSkillsDir;
  }

  get extensionDir(): string {
    return this._extensionDir;
  }
}