/**
 * context — 频道的上下文工厂。
 *
 * 从 ChannelManager 中提取，构建频道 init 时接收的 ChannelContext。
 */

import { createScopedLogger } from '@aesyclaw/core/logger';
import { createScopedRegistryActions, stripEnabledField } from '@aesyclaw/extension/extension-utils';
import type { ChannelContext, ChannelManagerDependencies } from './types';
import type { ResolvedPaths } from '@aesyclaw/core/path-resolver';
import { createChannelMessageApi } from './message-api';
import { createChannelSessionApi } from './session-api';

export function createContext(
  deps: ChannelManagerDependencies,
  paths: ResolvedPaths,
  channelName: string,
  ref: { current: Record<string, unknown> },
  receiveHook: ChannelContext['channel']['receive'],
  state: Record<string, unknown>,
): ChannelContext {
  const owner = `channel:${channelName}` as const;
  const registryActions = createScopedRegistryActions(deps, owner);

  return {
    name: channelName,
    get config() {
      return stripEnabledField(ref.current);
    },
    configManager: deps.configManager,
    paths,
    logger: createScopedLogger(`channel:${channelName}`),
    state,
    channel: createChannelMessageApi(deps, receiveHook),
    sessions: createChannelSessionApi(deps, channelName),
    models: {
      resolve: (providerModel) => deps.llmAdapter.resolveModel(providerModel),
    },
    registry: {
      tools: {
        register: registryActions.registerTool,
        unregister: registryActions.unregisterTool,
      },
      commands: {
        register: registryActions.registerCommand,
      },
    },
  };
}
