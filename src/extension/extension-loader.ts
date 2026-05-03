/** 用于扩展目录发现和动态导入的共享辅助函数。
 *
 * 本模块只提供纯工具函数；加载流程（发现候选 + 导入 + 校验）由
 * 各频道/插件加载器独立负责，不在此处泛化为基类。
 */

import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { errorMessage } from '@aesyclaw/core/utils';

export type ExtensionLoaderLogger = {
  warn(message: string, ...args: unknown[]): void;
};

/** 扩展组件的统一生命周期类型。 */
export type ExtensionLifecycle = {
  /** 加载并初始化（如从磁盘发现 + 导入 + 启动）。 */
  setup(): Promise<void>;
  /** 清理并释放资源。 */
  destroy(): Promise<void>;
};

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

  throw new Error(`${kind} 目录 "${extensionDir}" 没有 index.ts、index.js 或 index.mjs 入口文件`);
}

export async function importExtensionEntry(entryPath: string): Promise<unknown> {
  const entryUrl = pathToFileURL(entryPath);
  entryUrl.searchParams.set('mtime', String((await stat(entryPath)).mtimeMs));
  return await import(entryUrl.href);
}

export async function loadExtensionModule<T>(
  extensionDir: string,
  kind: string,
  validate: (imported: unknown) => T | null,
): Promise<{ definition: T; directory: string; directoryName: string; entryPath: string }> {
  const entryPath = await resolveExtensionEntry(extensionDir, kind);
  const imported = await importExtensionEntry(entryPath);
  const definition = validate(imported);

  if (definition === null) {
    throw new Error(`${kind}模块 "${entryPath}" 未导出有效的定义`);
  }

  return {
    definition,
    directory: extensionDir,
    directoryName: path.basename(extensionDir),
    entryPath,
  };
}
