/**
 * context — 频道的上下文工厂。
 *
 * 从 ChannelManager 中提取，构建频道 init 时接收的 ChannelContext。
 */

import { createScopedLogger } from '@aesyclaw/core/logger';
import { estimateApproximateTokens } from '@aesyclaw/session';
import type { SessionKey } from '@aesyclaw/core/types';
import type { ChannelContext, ChannelManagerDependencies } from './types';
import type { ResolvedPaths } from '@aesyclaw/core/path-resolver';

export function createContext(
  deps: ChannelManagerDependencies,
  paths: ResolvedPaths,
  channelName: string,
  config: Record<string, unknown>,
  receiveHook: ChannelContext['receive'],
): ChannelContext {
  const owner = `channel:${channelName}` as const;

  /** 获取指定会话的上下文窗口使用率。 */
  async function getSessionContextUsage(sessionKey: SessionKey): Promise<{
    estimatedTokens: number;
    contextWindow: number;
    percentage: number;
  }> {
    try {
      const session =
        deps.sessionManager.get(sessionKey) ??
        (await deps.sessionManager.create(sessionKey));
      const messages = session.get();
      const estimatedTokens = estimateApproximateTokens(messages);

      const roleId = (session as { roleId?: string }).roleId;
      const modelId = roleId ?? undefined;
      const contextWindow = modelId
        ? deps.llmAdapter.resolveModel(modelId).contextWindow
        : 128_000;

      return {
        estimatedTokens,
        contextWindow,
        percentage:
          contextWindow > 0
            ? Math.round((estimatedTokens / contextWindow) * 10000) / 100
            : 0,
      };
    } catch {
      return { estimatedTokens: 0, contextWindow: 0, percentage: 0 };
    }
  }

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
      if (!existing) return;
      if (existing.owner !== owner) return;
      deps.toolRegistry.unregister(name);
    },
    registerCommand: (command) => {
      deps.commandRegistry.register({ ...command, scope: owner });
    },
    getCommands: () =>
      deps.commandRegistry.getAll().map(({ execute: _execute, ...command }) => command),
    logger: createScopedLogger(`channel:${channelName}`),
    getSessionContextUsage,
  };
}
