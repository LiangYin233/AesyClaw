/** 动态频道扩展加载器。 */

import { createScopedLogger } from '../core/logger';
import { ExtensionLoader } from '../extensions/extension-loader';
import type { ChannelLoaderOptions, ChannelPlugin } from './channel-types';
import { isChannelPlugin } from './channel-types';
import { isRecord } from '../core/utils';

const logger = createScopedLogger('channel-loader');

/**
 * 动态频道扩展加载器。
 *
 * 负责发现和加载 `extensions/channel_*` 目录下的频道插件。
 * 支持四种导出形式(按优先级):
 *   1. `createChannel()` 工厂调用
 *   2. `create<Name>Channel()` 命名工厂(正则匹配)
 *   3. `default` 导出
 *   4. `channel` 命名导出
 */
export class ChannelLoader extends ExtensionLoader<ChannelPlugin> {
  constructor(options: ChannelLoaderOptions = {}) {
    super({
      extensionsDir: options.extensionsDir,
      directoryPrefix: 'channel_',
      kind: 'Channel',
      invalidMessage: '未导出有效的 ChannelPlugin',
      unreadableMessage: '频道扩展目录不可读',
      inspectFailureMessage: '检查频道目录候选失败',
      candidateField: 'channelDir',
      logger,
      extract: extractChannelDefinition,
    });
  }
}

function extractChannelDefinition(imported: unknown): ChannelPlugin | null {
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
