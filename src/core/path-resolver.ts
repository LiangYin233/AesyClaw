import path from 'node:path';
import { DIR_NAMES, FILE_NAMES } from './types';

/**
 * 不可变的解析路径集合。
 *
 * 整个应用中的文件 I/O 必须使用此处提供的路径 —— 禁止硬编码路径。
 */
export type ResolvedPaths = Readonly<{
  runtimeRoot: string;
  dataDir: string;
  configFile: string;
  dbFile: string;
  rolesFile: string;
  mediaDir: string;
  workspaceDir: string;
  skillsDir: string;
  userSkillsDir: string;
  extensionsDir: string;
  webDistDir: string;
}>;

/**
 * 从给定的根目录解析项目目录路径。
 *
 * 返回一个不可变对象，所有路径在创建时计算一次。
 * 必须在任何其他子系统初始化之前调用。
 *
 * @param root - 项目根目录（通常为 process.cwd()）
 * @returns 冻结的路径对象
 */
export function resolvePaths(root: string): ResolvedPaths {
  const runtimeRoot = path.join(root, DIR_NAMES.runtimeRoot);
  return Object.freeze({
    runtimeRoot,
    dataDir: path.join(runtimeRoot, DIR_NAMES.data),
    configFile: path.join(runtimeRoot, FILE_NAMES.config),
    dbFile: path.join(runtimeRoot, DIR_NAMES.data, FILE_NAMES.database),
    rolesFile: path.join(runtimeRoot, FILE_NAMES.roles),
    mediaDir: path.join(runtimeRoot, DIR_NAMES.media),
    workspaceDir: path.join(runtimeRoot, DIR_NAMES.workspace),
    /** 内置 skills 目录（`<project>/skills/`） */
    skillsDir: path.join(root, DIR_NAMES.skills),
    /** 用户自定义 skills 目录（`<project>/.aesyclaw/skills/`） */
    userSkillsDir: path.join(runtimeRoot, DIR_NAMES.skills),
    extensionsDir: path.join(root, DIR_NAMES.extensions),
    webDistDir: path.join(root, 'dist'),
  });
}
