/** 用于扩展目录发现和动态导入的共享辅助函数。 */

import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export type ExtensionLoaderLogger = {
  warn(message: string, ...args: unknown[]): void;
}

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
  const candidates = ['index.ts', 'index.js', 'index.mjs'].map((file) => path.join(extensionDir, file));
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

  throw new Error(
    `${kind} 目录 "${extensionDir}" 没有 index.ts、index.js 或 index.mjs 入口文件`,
  );
}

export async function importExtensionEntry(entryPath: string): Promise<unknown> {
  const entryUrl = pathToFileURL(entryPath);
  entryUrl.searchParams.set('mtime', String((await stat(entryPath)).mtimeMs));
  return await import(entryUrl.href);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
