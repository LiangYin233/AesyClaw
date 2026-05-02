/** 用于扩展目录发现和动态导入的共享辅助函数。 */

import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { errorMessage } from '../core/utils';

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

/**
 * 通用扩展加载器基类:统一 `discover()` + `load()` 流程,
 * 子类只需提供 directoryPrefix、kind、和 `extract()` 验证器即可。
 *
 * 该类把 PluginLoader / ChannelLoader 共享的"扫描目录、解析入口、动态 import"
 * 逻辑抽出。`extract()` 负责把 imported 模块转换为定义对象,
 * 由具体子类决定接受哪些导出形式(`default`、命名导出、工厂等)。
 */
export type ExtensionLoaderConfig<T> = {
  extensionsDir?: string;
  directoryPrefix: string;
  kind: string;
  invalidMessage: string;
  unreadableMessage: string;
  inspectFailureMessage: string;
  candidateField: string;
  logger: ExtensionLoaderLogger;
  extract: (imported: unknown) => T | null;
}

export type ExtensionModule<T> = {
  definition: T;
  directory: string;
  directoryName: string;
  entryPath: string;
}

export class ExtensionLoader<T> {
  protected readonly extensionsDir: string;
  private readonly config: ExtensionLoaderConfig<T>;

  constructor(config: ExtensionLoaderConfig<T>) {
    this.extensionsDir = config.extensionsDir ?? path.resolve(process.cwd(), 'extensions');
    this.config = config;
  }

  async discover(): Promise<string[]> {
    return await discoverExtensionDirs({
      extensionsDir: this.extensionsDir,
      directoryPrefix: this.config.directoryPrefix,
      logger: this.config.logger,
      unreadableMessage: this.config.unreadableMessage,
      inspectFailureMessage: this.config.inspectFailureMessage,
      candidateField: this.config.candidateField,
    });
  }

  async load(extensionDir: string): Promise<ExtensionModule<T>> {
    const entryPath = await resolveExtensionEntry(extensionDir, this.config.kind);
    const imported = await importExtensionEntry(entryPath);
    const definition = this.config.extract(imported);

    if (definition === null) {
      throw new Error(`${this.config.kind}模块 "${entryPath}" ${this.config.invalidMessage}`);
    }

    return {
      definition,
      directory: extensionDir,
      directoryName: path.basename(extensionDir),
      entryPath,
    };
  }
}
