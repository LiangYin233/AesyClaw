/**
 * context — 频道的上下文工厂。
 *
 * 从 ChannelManager 中提取，构建频道 init 时接收的 ChannelContext。
 */

import { createScopedLogger } from '@aesyclaw/core/logger';
import { stripEnabledField } from '@aesyclaw/extension/extension-utils';
import { estimateApproximateTokens } from '@aesyclaw/session';
import type { SessionKey } from '@aesyclaw/core/types';
import type { ChannelContext, ChannelManagerDependencies } from './types';
import type { ResolvedPaths } from '@aesyclaw/core/path-resolver';

export function createContext(
  deps: ChannelManagerDependencies,
  paths: ResolvedPaths,
  channelName: string,
  ref: { current: Record<string, unknown> },
  receiveHook: ChannelContext['receive'],
  state: Record<string, unknown>,
): ChannelContext {
  const owner = `channel:${channelName}` as const;
  const log = createScopedLogger(`ctx:${channelName}`);
  /** 获取指定会话的上下文窗口使用率。 */
  async function getSessionContextUsage(sessionKey: SessionKey): Promise<{
    estimatedTokens: number;
    contextWindow: number;
    percentage: number;
  }> {
    try {
      const session =
        deps.sessionManager.get(sessionKey) ?? (await deps.sessionManager.create(sessionKey));
      const messages = session.get();
      const estimatedTokens = estimateApproximateTokens(messages);

      const record = await deps.databaseManager.sessions.findById(session.sessionId);
      const roleId = record?.role_id;
      const modelId = roleId ?? undefined;
      const contextWindow = modelId ? deps.llmAdapter.resolveModel(modelId).contextWindow : 128_000;

      return {
        estimatedTokens,
        contextWindow,
        percentage:
          contextWindow > 0 ? Math.round((estimatedTokens / contextWindow) * 10000) / 100 : 0,
      };
    } catch (err) {
      log.warn('getSessionContextUsage 失败', err);
      return { estimatedTokens: 0, contextWindow: 0, percentage: 0 };
    }
  }

  /** 获取所有会话列表 */
  async function getSessions(): Promise<
    Array<{
      id: string;
      channel: string;
      type: string;
      chatId: string;
      title: string;
      firstUserMessage?: string;
      messageCount?: number;
      lastActivity?: string;
    }>
  > {
    try {
      const records = await deps.databaseManager.sessions.findAllSummaries();
      return records.map((s) => ({
        ...s,
        title: (s.firstUserMessage ?? s.chatId).slice(0, 30),
      }));
    } catch (err) {
      log.warn('getSessions 失败', err);
      return [];
    }
  }

  /** 获取指定会话的消息历史 */
  async function getSessionMessages(
    sessionKey: SessionKey,
  ): Promise<Array<{ role: string; content: string; timestamp?: string; toolData?: string }>> {
    try {
      const session =
        deps.sessionManager.get(sessionKey) ?? (await deps.sessionManager.create(sessionKey));
      const dbSession = await deps.databaseManager.sessions.findById(
        (session as { sessionId: string }).sessionId,
      );
      if (!dbSession) return [];
      return await deps.databaseManager.messages.loadHistory(dbSession.id);
    } catch (err) {
      log.warn('getSessionMessages 失败', err);
      return [];
    }
  }

  return {
    name: channelName,
    get config() {
      // 频道上下文中剥离 enabled 字段
      return stripEnabledField(ref.current);
    },
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
    getSessions,
    getSessionMessages,
    state,
    resolveModel: (providerModel) => deps.llmAdapter.resolveModel(providerModel),
  };
}
