/** @file 已发现模块加载器
 *
 * 负责加载通过 plugin-discovery 发现的插件/频道模块。
 * 使用动态 import() 加载入口文件，验证模块是否导出 name 字段，
 * 并校验 package.json 中的名称与导出名称是否一致。
 */

import { pathToFileURL } from 'url';
import { getDiscoveredPluginEntryCandidates, resolveDiscoveredPluginEntry } from './plugin-entry.js';
import { assertPackageNameMatchesExportedName } from './package-manifest.js';
import type { DiscoveredPlugin } from './plugin-discovery.js';

interface NamedDiscoveredModule {
  name?: string;
}

/** 已加载的发现模块结果 */
export interface LoadedDiscoveredModule<TModule extends NamedDiscoveredModule> {
  entryPath: string | null;
  candidates: string[];
  module: TModule | null;
}

/** 加载已发现的模块
 *
 * 尝试解析入口文件路径，动态导入模块，验证 name 字段，
 * 并校验 package.json 名称与导出名称的一致性。
 */
export async function loadDiscoveredModule<TModule extends NamedDiscoveredModule>(
  discovered: DiscoveredPlugin,
  moduleLabel: string
): Promise<LoadedDiscoveredModule<TModule>> {
  const candidates = getDiscoveredPluginEntryCandidates(discovered);
  const entryPath = resolveDiscoveredPluginEntry(discovered);
  if (!entryPath) {
    return {
      entryPath: null,
      candidates,
      module: null,
    };
  }

  const imported = await import(pathToFileURL(entryPath).href);
  const loadedModule = (imported.default || imported) as TModule | undefined;
  if (!loadedModule?.name) {
    throw new Error(`Invalid ${moduleLabel.toLowerCase()} module, missing name`);
  }

  assertPackageNameMatchesExportedName(discovered.packageJson, loadedModule.name, moduleLabel);

  return {
    entryPath,
    candidates,
    module: loadedModule,
  };
}
