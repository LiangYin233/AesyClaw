/** 用于扩展目录发现和动态导入的共享辅助函数。 */

import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ErrorCode, ExtensionError, errorMessage, type ExtensionKind } from '@aesyclaw/core/errors';

/** 扩展加载器的日志适配接口。 */
export type ExtensionLoaderLogger = {
  warn(message: string, ...args: unknown[]): void;
};

/** 已加载的扩展模块（含定义、目录和入口路径）。 */
export type LoadedExtensionModule<T> = {
  definition: T;
  directory: string;
  directoryName: string;
  entryPath: string;
};

/**
 * 发现符合前缀约定的扩展目录。
 *
 * @param options - 发现选项（目录、前缀、日志器等）
 * @returns 按名称排序的扩展目录路径列表
 */
export async function discoverExtensionDirs(options: {
  extensionsDir: string;
  directoryPrefix: string;
  logger: ExtensionLoaderLogger;
  unreadableMessage: string;
  inspectFailureMessage: string;
  candidateField: string;
}): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(options.extensionsDir);
  } catch (err) {
    options.logger.warn(options.unreadableMessage, {
      extensionsDir: options.extensionsDir,
      error: errorMessage(err),
    });
    return [];
  }

  const dirs: string[] = [];
  for (const entry of entries) {
    if (!entry.startsWith(options.directoryPrefix)) {
      continue;
    }

    const fullPath = path.join(options.extensionsDir, entry);
    try {
      const entryStat = await stat(fullPath);
      if (entryStat.isDirectory()) {
        dirs.push(fullPath);
      }
    } catch (err) {
      options.logger.warn(options.inspectFailureMessage, {
        [options.candidateField]: fullPath,
        error: errorMessage(err),
      });
    }
  }

  return dirs.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

/**
 * 解析扩展目录的入口文件。
 *
 * @param extensionDir - 扩展目录路径
 * @param kind - 扩展类型标识（如 "Plugin" / "Channel"）
 * @returns 入口文件完整路径
 * @throws 目录中不存在 index.ts/js/mjs 时抛出
 */
export async function resolveExtensionEntry(extensionDir: string, kind: string): Promise<string> {
  const candidates = ['index.ts', 'index.js', 'index.mjs'].map((file) =>
    path.join(extensionDir, file),
  );
  for (const candidate of candidates) {
    try {
      const candidateStat = await stat(candidate);
      if (candidateStat.isFile()) {
        return candidate;
      }
    } catch {
      // 尝试下一个支持的入口文件名。
    }
  }

  throw new ExtensionError(
    ErrorCode.EXTENSION_LOAD_FAILED,
    `${kind} 目录 "${extensionDir}" 没有 index.ts、index.js 或 index.mjs 入口文件`,
    {
      extensionKind: normalizeLoaderKind(kind),
      extensionName: path.basename(extensionDir),
      extensionDir,
    },
  );
}

/**
 * 动态导入扩展入口模块（附加 mtime 查询参数以绕过缓存）。
 *
 * @param entryPath - 入口文件路径
 * @returns 模块导出的原始值
 */
export async function importExtensionEntry(entryPath: string): Promise<unknown> {
  const entryUrl = pathToFileURL(entryPath);
  entryUrl.searchParams.set('mtime', String((await stat(entryPath)).mtimeMs));
  return await import(entryUrl.href);
}

/**
 * 加载并校验单个扩展模块。
 *
 * @param extensionDir - 扩展目录
 * @param kind - 扩展类型标识
 * @param validate - 校验函数，将导入值转为有效定义或 null
 * @returns 已加载的扩展模块
 * @throws 入口文件不存在或校验失败时抛出
 */
export async function loadExtensionModule<T>(
  extensionDir: string,
  kind: string,
  validate: (imported: unknown) => T | null,
): Promise<LoadedExtensionModule<T>> {
  const entryPath = await resolveExtensionEntry(extensionDir, kind);
  const imported = await importExtensionEntry(entryPath);
  const definition = validate(imported);

  if (definition === null) {
    throw new ExtensionError(
      ErrorCode.EXTENSION_LOAD_FAILED,
      `${kind}模块 "${entryPath}" 未导出有效的定义`,
      {
        extensionKind: normalizeLoaderKind(kind),
        extensionName: path.basename(extensionDir),
        extensionDir,
        entryPath,
      },
    );
  }

  return {
    definition,
    directory: extensionDir,
    directoryName: path.basename(extensionDir),
    entryPath,
  };
}

function normalizeLoaderKind(kind: string): ExtensionKind {
  switch (kind.toLowerCase()) {
    case 'plugin':
      return 'plugin';
    case 'channel':
      return 'channel';
    default:
      return 'extension';
  }
}
