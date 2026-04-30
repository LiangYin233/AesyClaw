/** 动态频道扩展加载器。 */

import path from 'node:path';
import { createScopedLogger } from '../core/logger';
import {
  discoverExtensionDirs,
  importExtensionEntry,
  resolveExtensionEntry,
} from '../extensions/extension-loader';
import type { ChannelLoaderOptions, ChannelModule, ChannelPlugin } from './channel-types';
import { isChannelPlugin, isRecord } from './channel-types';

const logger = createScopedLogger('channel-loader');

/**
 * 动态频道扩展加载器。
 *
 * 负责发现和加载 `extensions/channel_*` 目录下的频道插件。
 */
export class ChannelLoader {
  private readonly extensionsDir: string;

  /**
   * 创建频道加载器实例。
   *
   * @param options - 加载器选项
   */
  constructor(options: ChannelLoaderOptions = {}) {
    this.extensionsDir = options.extensionsDir ?? path.resolve(process.cwd(), 'extensions');
  }

  /**
   * 发现所有频道扩展目录。
   *
   * @returns 频道扩展目录的绝对路径数组
   */
  async discover(): Promise<string[]> {
    return await discoverExtensionDirs({
      extensionsDir: this.extensionsDir,
      directoryPrefix: 'channel_',
      logger,
      unreadableMessage: '频道扩展目录不可读',
      inspectFailureMessage: '检查频道目录候选失败',
      candidateField: 'channelDir',
    });
  }

  /**
   * 加载指定目录的频道模块。
   *
   * @param channelDir - 频道扩展目录的绝对路径
   * @returns 加载的频道模块
   * @throws 如果模块未导出有效的 ChannelPlugin 则抛出错误
   */
  async load(channelDir: string): Promise<ChannelModule> {
    const entryPath = await resolveExtensionEntry(channelDir, 'Channel');
    const imported = await importExtensionEntry(entryPath);
    const definition = extractDefinition(imported);

    if (!definition) {
      throw new Error(`频道模块 "${entryPath}" 未导出有效的 ChannelPlugin`);
    }

    logger.debug('已加载频道模块', { channelDir, entryPath, channelName: definition.name });
    return {
      definition,
      directory: channelDir,
      directoryName: path.basename(channelDir),
      entryPath,
    };
  }
}

function extractDefinition(imported: unknown): ChannelPlugin | null {
  if (!isRecord(imported)) {
    return null;
  }

  const factoryCandidate = imported.createChannel;
  if (typeof factoryCandidate === 'function') {
    const channel = factoryCandidate();
    if (isChannelPlugin(channel)) {
      return channel;
    }
  }

  for (const [exportName, exported] of Object.entries(imported)) {
    if (!/^create[A-Z].*Channel$/.test(exportName) || typeof exported !== 'function') {
      continue;
    }

    const channel = exported();
    if (isChannelPlugin(channel)) {
      return channel;
    }
  }

  const directCandidate = imported.default ?? imported.channel;
  if (isChannelPlugin(directCandidate)) {
    return directCandidate;
  }

  return null;
}
