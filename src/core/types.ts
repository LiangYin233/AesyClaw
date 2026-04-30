/** 共享核心类型的兼容导出桶。 */

import { readFileSync } from 'node:fs';

function readRootPackageVersion(): string {
  const packageJsonUrl = new URL('../../package.json', import.meta.url);
  const packageJson: unknown = JSON.parse(readFileSync(packageJsonUrl, 'utf8'));

  if (
    typeof packageJson === 'object' &&
    packageJson !== null &&
    'version' in packageJson &&
    typeof packageJson.version === 'string'
  ) {
    return packageJson.version;
  }

  throw new Error('Root package.json is missing a string version field');
}

export const APP_NAME = 'AesyClaw';
export const APP_VERSION = readRootPackageVersion();

/** 默认目录名（相对于根目录） */
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

/** 默认文件名 */
export const FILE_NAMES = {
  config: 'config.json',
  database: 'aesyclaw.db',
} as const;

/** 运行时默认值和模式元数据共享的默认配置值 */
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
