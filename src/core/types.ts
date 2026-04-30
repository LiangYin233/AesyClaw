/** Compatibility barrel for shared core types. */

export const APP_NAME = 'AesyClaw';
export const APP_VERSION = '0.1.0';

/** Default directory names (relative to root) */
export const DIR_NAMES = {
  runtimeRoot: '.aesyclaw',
  data: 'data',
  roles: 'roles',
  media: 'media',
  workspace: 'workspace',
  skills: 'skills',
  userSkills: 'skills',
  systemSkills: 'skills/system',
  extensions: 'extensions',
} as const;

/** Default file names */
export const FILE_NAMES = {
  config: 'config.json',
  database: 'aesyclaw.db',
} as const;

/** Default config values shared by runtime defaults and schema metadata */
export const DEFAULTS = {
  port: 3000,
  host: '0.0.0.0',
  logLevel: 'info',
  compressionThreshold: 0.8,
} as const;

export type * from './identity-types';
export type * from './message-types';
export type * from './database-types';
export type * from './domain-types';
export type * from './utility-types';
