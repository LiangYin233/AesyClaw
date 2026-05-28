/**
 * context — 插件的上下文工厂。
 *
 * 从 PluginManager 中提取，构建插件 init 时接收的 PluginContext。
 */

import { createScopedLogger } from '@aesyclaw/core/logger';
import { pluginOwner, type PluginContext, type PluginManagerDependencies } from './types';
import type { ResolvedPaths } from '@aesyclaw/core/path-resolver';

export function createPluginContext(
  deps: PluginManagerDependencies,
  paths: ResolvedPaths,
  pluginName: string,
  ref: { current: Record<string, unknown> },
  state: Record<string, unknown>,
): PluginContext {
  const owner = pluginOwner(pluginName);
  return {
    get config() {
      return ref.current;
    },
    paths,
    configManager: deps.configManager,
    registerTool: (tool) => {
      deps.toolRegistry.register({ ...tool, owner });
    },
    unregisterTool: (name) => {
      const existing = deps.toolRegistry.get(name);
      if (!existing) return;
      if (existing.owner !== owner) return;
      deps.toolRegistry.unregister(name);
    },
    registerCommand: (command) => {
      deps.commandRegistry.register({ ...command, scope: owner });
    },
    registerChannel: (channel) => {
      if (!deps.channelManager) {
        throw new Error('ChannelManager 对插件不可用');
      }
      deps.channelManager.register(channel, owner);
    },
    logger: createScopedLogger(owner),
    state,
    resolveModel: (providerModel) => deps.llmAdapter.resolveModel(providerModel),
  };
}
