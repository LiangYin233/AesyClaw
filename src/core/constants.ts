/**
 * Application-wide constants.
 */

export const APP_NAME = 'AesyClaw';
export const APP_VERSION = '0.1.0';

/** Default directory names (relative to root) */
export const DIR_NAMES = {
  data: 'data',
  roles: 'roles',
  skills: 'skills',
  systemSkills: 'skills/system',
  extension: 'extension',
} as const;

/** Default file names */
export const FILE_NAMES = {
  config: 'config.json',
  database: 'aesyclaw.db',
} as const;

/** Default config values that don't belong in the schema defaults */
export const DEFAULTS = {
  port: 3000,
  host: '0.0.0.0',
  logLevel: 'info',
  maxSteps: 10,
  maxContextTokens: 128000,
  compressionThreshold: 0.8,
} as const;