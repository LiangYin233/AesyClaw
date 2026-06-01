/**
 * context — 频道的上下文工厂。
 *
 * 从 ChannelManager 中提取，构建频道 init 时接收的 ChannelContext。
 */

import { createScopedLogger } from '@aesyclaw/core/logger';
import {
  createScopedRegistryActions,
  stripEnabledField,
} from '@aesyclaw/extension/extension-utils';
import type { SessionKey } from '@aesyclaw/core/types';
import { toSessionMessageDto } from '@aesyclaw/session';
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
  const registryActions = createScopedRegistryActions(deps, owner);
  /** 获取指定会话的上下文占用（input/output token 数 + 模型上下文窗口）。
   * 优先从 SQLite usage 表读取，回退到会话消息中的 usage 字段。
   */
  async function getSessionContextUsage(sessionKey: SessionKey): Promise<{
    inputTokens: number;
    outputTokens: number;
    contextWindow: number;
  }> {
    try {
      const session =
        deps.sessionManager.get(sessionKey) ?? (await deps.sessionManager.create(sessionKey));
      const record = await deps.databaseManager.sessions.findById(session.sessionId);
      if (!record?.model_id) throw new Error('会话未绑定模型');
      const modelId = record.model_id;
      const resolved = deps.llmAdapter.resolveModel(modelId);

      let inputTokens = 0;
      let outputTokens = 0;
      const dbUsage = await deps.databaseManager.usage.getLatestContextUsage(session.sessionId);
      if (dbUsage?.inputTokens !== undefined && dbUsage.inputTokens > 0) {
        inputTokens = dbUsage.inputTokens;
        outputTokens = dbUsage.outputTokens;
      } else {
        // 回退到会话消息中的 usage
        const msgs = session.get();
        for (let i = msgs.length - 1; i >= 0; i--) {
          const u = (msgs[i] as unknown as { usage?: { input?: number; output?: number } }).usage;
          if (u?.input !== undefined && u.input > 0) {
            inputTokens = u.input;
            outputTokens = u.output ?? 0;
            break;
          }
        }
      }

      return { inputTokens, outputTokens, contextWindow: resolved.contextWindow };
    } catch (err) {
      log.warn('getSessionContextUsage 失败', err);
      return { inputTokens: 0, outputTokens: 0, contextWindow: 0 };
    }
  }

  /** 获取所有会话列表 */
  async function getSessions(): ReturnType<ChannelContext['getSessions']> {
    try {
      return await deps.sessionManager.getSummaries();
    } catch (err) {
      log.warn('getSessions 失败', err);
      return [];
    }
  }

  /** 获取指定会话的消息历史 */
  async function getSessionMessages(
    sessionKey: SessionKey,
  ): ReturnType<ChannelContext['getSessionMessages']> {
    try {
      const session =
        deps.sessionManager.get(sessionKey) ?? (await deps.sessionManager.create(sessionKey));
      const messages = await deps.sessionManager.getMessagesById(session.sessionId);
      return toSessionMessageDto(messages);
    } catch (err) {
      log.warn('getSessionMessages 失败', err);
      return [];
    }
  }

  /** 获取指定会话绑定的模型和角色 ID */
  async function getSessionModel(
    sessionKey: SessionKey,
  ): Promise<{ modelId?: string; roleId?: string }> {
    try {
      const session =
        deps.sessionManager.get(sessionKey) ?? (await deps.sessionManager.create(sessionKey));
      const record = await deps.databaseManager.sessions.findById(session.sessionId);
      return {
        modelId: record?.model_id ?? undefined,
        roleId: record?.role_id ?? undefined,
      };
    } catch {
      return {};
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
    ...registryActions,
    getCommands: () =>
      deps.commandRegistry.getAll().map(({ execute: _execute, ...command }) => command),
    logger: createScopedLogger(`channel:${channelName}`),
    getSessionContextUsage,
    getSessions,
    getSessionMessages,
    getSessionModel,
    state,
    resolveModel: (providerModel) => deps.llmAdapter.resolveModel(providerModel),
  };
}
