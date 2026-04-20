import { pathToFileURL } from 'url';
import { getDiscoveredPluginEntryCandidates, resolveDiscoveredPluginEntry } from './plugin-entry.js';
import { assertPackageNameMatchesExportedName } from './package-manifest.js';
import type { DiscoveredPlugin } from './plugin-discovery.js';

interface NamedDiscoveredModule {
  name?: string;
}

export interface LoadedDiscoveredModule<TModule extends NamedDiscoveredModule> {
  entryPath: string | null;
  candidates: string[];
  module: TModule | null;
}

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
