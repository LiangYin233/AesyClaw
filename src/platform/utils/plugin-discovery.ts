import * as fs from 'fs';
import * as path from 'path';
import { logger } from '@/platform/observability/logger.js';
import { type PackageManifest, readPackageManifest } from './package-manifest.js';

export interface DiscoveredPlugin {
  dir: string;
  dirName: string;
  packageJson: PackageManifest;
  name: string;
}

export function discoverPluginsByPrefix(pluginsDir: string, prefix: string): DiscoveredPlugin[] {
  if (!fs.existsSync(pluginsDir)) return [];

  const results: DiscoveredPlugin[] = [];
  for (const entry of fs.readdirSync(pluginsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue;

    const dir = path.join(pluginsDir, entry.name);
    const packageJson = readPackageManifest(path.join(dir, 'package.json'));
    if (!packageJson) {
      logger.warn({ dir }, 'Plugin missing package.json, skipping');
      continue;
    }

    results.push({
      dir,
      dirName: entry.name,
      packageJson,
      name: packageJson.name || entry.name,
    });
  }
  return results;
}
