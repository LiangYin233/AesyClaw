/** @file 插件发现工具
 *
 * 扫描指定目录下符合前缀（plugin_ / channel_）的子目录，
 * 读取 package.json 并返回发现的插件信息。
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '@/platform/observability/logger.js';
import { type PackageManifest, readPackageManifest } from './package-manifest.js';

/** 发现的插件信息 */
export interface DiscoveredPlugin {
    dir: string;
    dirName: string;
    packageJson: PackageManifest;
    name: string;
}

/** 按前缀扫描目录并发现插件
 *
 * 遍历目录下的子目录，筛选名称以 prefix 开头的目录，
 * 读取 package.json 并返回发现的插件列表。
 */
export function discoverPluginsByPrefix(pluginsDir: string, prefix: string): DiscoveredPlugin[] {
    if (!fs.existsSync(pluginsDir)) {
        return [];
    }

    const results: DiscoveredPlugin[] = [];
    for (const entry of fs.readdirSync(pluginsDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.startsWith(prefix)) {
            continue;
        }

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
