/**
 * session-compactor — 使用 LLM 压缩会话历史为摘要。
 *
 * 从 Session 类中提取，专注压缩逻辑，
 * Session 只保留状态管理与持久化。
 */

import type { AgentMessage, ResolvedModel } from '@aesyclaw/contracts/llm';
import { extractMessageText, makeExtraBodyOnPayload } from '@aesyclaw/contracts/llm';
import type { LlmAdapter } from '@aesyclaw/agent/llm/adapter';
import {
  withDefaultPromptCacheModel,
  withDefaultPromptCacheOptions,
} from '@aesyclaw/agent/llm/cache-options';
import type { MessagesRepository, UsageRepository } from '@aesyclaw/core/database/database-manager';
import { completeSimple, type AssistantMessage } from '@mariozechner/pi-ai';
import { createScopedLogger } from '@aesyclaw/core/logger';
import { estimateApproximateTokens } from './session';

const logger = createScopedLogger('session-compactor');

export type CompactorSession = {
  readonly sessionId: string;
  readonly _messages: readonly AgentMessage[];
  get(): readonly AgentMessage[];
  bind(): Promise<void>;
};

/**
 * 使用 LLM 压缩会话历史。
 */
export async function compactSession(
  llmAdapter: LlmAdapter,
  modelIdentifier: string,
  session: {
    sessionId: string;
    get(): readonly AgentMessage[];
    bind(): Promise<void>;
    db?: { messages: MessagesRepository; usage?: UsageRepository };
    _messages?: readonly AgentMessage[];
  },
): Promise<string> {
  const model = llmAdapter.resolveModel(modelIdentifier);
  const messages = session.get() as AgentMessage[];
  logger.info('正在压缩会话历史', {
    sessionId: session.sessionId,
    messageCount: messages.length,
    totalTokens: `${estimateApproximateTokens(messages)}/${model.contextWindow}`,
  });

  const { summary, message } = await summarizeConversation(model, messages, session.sessionId);

  if (session.db?.usage) {
    try {
      await session.db.usage.create({
        model: message.model,
        provider: message.provider,
        api: message.api,
        responseId: message.responseId,
        usage: message.usage,
        sessionId: session.sessionId,
      });
    } catch (err) {
      logger.error('记录压缩用量失败', err);
    }
  }

  await session.db?.messages.replaceWithSummary(session.sessionId, summary);
  await session.bind();

  logger.info('会话历史已压缩', {
    sessionId: session.sessionId,
    summaryLength: summary.length,
  });

  return summary;
}

/**
 * 调用 LLM 生成会话摘要。
 */
async function summarizeConversation(
  model: ResolvedModel,
  messages: AgentMessage[],
  sessionId: string,
): Promise<{ summary: string; message: AssistantMessage }> {
  const prompt = buildSummaryPrompt(messages);

  const cacheModel = withDefaultPromptCacheModel(model);
  const response = await completeSimple(
    cacheModel,
    {
      systemPrompt: [
        'You are a conversation archivist. Summarize the following dialogue into a compact record for future turns.',
        'Output ONLY the summary in the following structure, using plain text:',
        '',
        '## Previous Discussion',
        '- What has already been discussed with the user (topics, decisions made, conclusions reached)',
        '',
        '## Current Focus',
        '- What is being worked on or discussed right now (the active task or question)',
        '',
        '## Next Steps',
        '- What remains to be done, unresolved questions, or pending follow-ups',
        '',
        '## Notes',
        '- Special constraints, important facts, user preferences, tool results, file paths, or any context critical for continuity',
        '',
        'Keep each section concise. Do not mention that you are summarizing or refer to missing context.',
      ].join('\n'),
      messages: [{ role: 'user', content: prompt, timestamp: Date.now() }],
    },
    withDefaultPromptCacheOptions(cacheModel, {
      apiKey: model.apiKey,
      sessionId,
      onPayload: makeExtraBodyOnPayload(model),
    }),
  );

  const summary = extractMessageText(response).trim();
  if (summary.length === 0) throw new Error('LLM 返回了空总结');
  return { summary, message: response };
}

function buildSummaryPrompt(messages: AgentMessage[]): string {
  const transcript = messages
    .map((m) => `${m.role.toUpperCase()}: ${extractMessageText(m).trim()}`)
    .filter((line) => !line.endsWith(':'))
    .join('\n\n');
  return ['Conversation transcript:', '', transcript].join('\n');
}
