import { createScopedLogger } from '@aesyclaw/core/logger';
import type { SessionKey } from '@aesyclaw/core/types';
import { toSessionMessageDto } from '@aesyclaw/session';
import type { ChannelManagerDependencies, ChannelSessionApi } from './types';

export function createChannelSessionApi(
  deps: ChannelManagerDependencies,
  channelName: string,
): ChannelSessionApi {
  const log = createScopedLogger(`ctx:${channelName}`);

  return {
    getContextUsage: async (sessionKey) => {
      try {
        const session =
          deps.sessionManager.get(sessionKey) ?? (await deps.sessionManager.create(sessionKey));
        const record = await deps.databaseManager.sessions.findById(session.sessionId);
        if (!record?.model_id) throw new Error('会话未绑定模型');
        const resolved = deps.llmAdapter.resolveModel(record.model_id);

        let inputTokens = 0;
        let outputTokens = 0;
        const dbUsage = await deps.databaseManager.usage.getLatestContextUsage(session.sessionId);
        if (dbUsage?.inputTokens !== undefined && dbUsage.inputTokens > 0) {
          inputTokens = dbUsage.inputTokens;
          outputTokens = dbUsage.outputTokens;
        } else {
          const messages = session.get();
          for (let i = messages.length - 1; i >= 0; i -= 1) {
            const usage = (messages[i] as unknown as { usage?: { input?: number; output?: number } })
              .usage;
            if (usage?.input !== undefined && usage.input > 0) {
              inputTokens = usage.input;
              outputTokens = usage.output ?? 0;
              break;
            }
          }
        }

        return { inputTokens, outputTokens, contextWindow: resolved.contextWindow };
      } catch (err) {
        log.warn('getSessionContextUsage 失败', err);
        return { inputTokens: 0, outputTokens: 0, contextWindow: 0 };
      }
    },
    list: async () => {
      try {
        return await deps.sessionManager.getSummaries();
      } catch (err) {
        log.warn('getSessions 失败', err);
        return [];
      }
    },
    getMessages: async (sessionKey) => {
      try {
        const session =
          deps.sessionManager.get(sessionKey) ?? (await deps.sessionManager.create(sessionKey));
        const messages = await deps.sessionManager.getMessagesById(session.sessionId);
        return toSessionMessageDto(messages);
      } catch (err) {
        log.warn('getSessionMessages 失败', err);
        return [];
      }
    },
    getModel: async (sessionKey: SessionKey) => {
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
    },
  };
}
