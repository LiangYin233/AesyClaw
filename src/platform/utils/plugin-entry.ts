import * as fs from 'fs';
import * as path from 'path';
import type { DiscoveredPlugin } from './plugin-discovery.js';

export function getDiscoveredPluginEntryCandidates(discovered: DiscoveredPlugin): string[] {
    const mainFile = discovered.packageJson.main || 'dist/index.js';
    return [
        path.join(discovered.dir, mainFile),
        path.join(discovered.dir, 'index.ts'),
        path.join(discovered.dir, 'src/index.ts'),
    ];
}

export function resolveDiscoveredPluginEntry(discovered: DiscoveredPlugin): string | undefined {
    return getDiscoveredPluginEntryCandidates(discovered).find((candidate) => {
        try {
            return fs.existsSync(candidate);
        } catch {
            return false;
        }
    });
}
