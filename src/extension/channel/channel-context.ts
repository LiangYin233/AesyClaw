/**
 * channel-context — 频道的上下文工厂。
 *
 * 从 ChannelManager 中提取，构建频道 init 时接收的 ChannelContext。
 */

import { createScopedLogger } from '@aesyclaw/core/logger';
import type { ChannelContext, ChannelManagerDependencies } from './channel-types';
import type { ResolvedPaths } from '@aesyclaw/core/path-resolver';

export function createContext(
  deps: ChannelManagerDependencies,
  paths: ResolvedPaths,
  channelName: string,
  config: Record<string, unknown>,
  receiveHook: ChannelContext['receive'],
): ChannelContext {
  const owner = `channel:${channelName}` as const;
  return {
    name: channelName,
    config,
    configManager: deps.configManager,
    paths,
    receive: receiveHook,
    registerTool: (tool) => {
      deps.toolRegistry.register({ ...tool, owner });
    },
    unregisterTool: (name) => {
      const existing = deps.toolRegistry.get(name);
      if (!existing) {
        return;
      }
      if (existing.owner !== owner) {
        return;
      }
      deps.toolRegistry.unregister(name);
    },
    registerCommand: (command) => {
      deps.commandRegistry.register({ ...command, scope: owner });
    },
    getCommands: () =>
      deps.commandRegistry
        .getAll()
        .map(({ execute: _execute, ...command }) => command),
    logger: createScopedLogger(`channel:${channelName}`),
  };
}
