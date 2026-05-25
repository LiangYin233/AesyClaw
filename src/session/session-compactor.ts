/**
 * session-compactor — 使用 LLM 压缩会话历史为摘要。
 *
 * 从 Session 类中提取，专注压缩逻辑，
 * Session 只保留状态管理与持久化。
 */

import {
  extractMessageText,
  makeExtraBodyOnPayload,
  type AgentMessage,
  type ModelResolver,
  type ResolvedModel,
} from '@aesyclaw/contracts/llm';
import {
  withDefaultPromptCacheModel,
  withDefaultPromptCacheOptions,
} from '@aesyclaw/agent/llm/cache-options';
import type { MessagesRepository, UsageRepository } from '@aesyclaw/core/database/database-manager';
import { completeSimple, type AssistantMessage } from '@mariozechner/pi-ai';
import { createScopedLogger } from '@aesyclaw/core/logger';
import { estimateApproximateTokens } from './token-utils';

const logger = createScopedLogger('session-compactor');

export type CompactorSession = {
  readonly sessionId: string;
  get(): readonly AgentMessage[];
  bind(): Promise<void>;
};

/**
 * 使用 LLM 压缩会话历史。
 */
export async function compactSession(
  llmResolver: ModelResolver,
  modelIdentifier: string,
  session: {
    sessionId: string;
    get(): readonly AgentMessage[];
    bind(): Promise<void>;
    db?: { messages: MessagesRepository; usage?: UsageRepository };
  },
): Promise<string> {
  const model = llmResolver.resolveModel(modelIdentifier);
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
        'Output ONLY the summary in the following structured format, using plain text:',
        '',
        'Goal',
        '- The explicit objective, task, or request the user has stated. What are we building, fixing, or deciding?',
        '',
        'Constraints',
        '- Specific constraints, tech stack preferences, architecture choices already mandated by the user (e.g. "use TypeScript", "no new backend", "must be stateless"). Include file paths or config locations if relevant.',
        '',
        'Progress',
        '- Track what has been completed [x], what is in progress, and what is blocked. Use a concise checklist format. Note the commit or change that completed each item when known.',
        '',
        'Key Decisions',
        '- Important design or implementation decisions and the reasoning behind them. Capture tradeoffs considered and why the chosen approach won.',
        '',
        'Next Steps',
        '- Concrete, ordered list of what remains. Include file paths and specific functions to modify when known.',
        '',
        'Critical Context',
        '- File paths, data formats, API endpoints, credentials locations, or any other concrete information needed to continue work without re-reading source files.',
        '',
        'Keep each section concise but informative. If a section has no content, omit it entirely. Do not mention that you are summarizing or refer to missing context.',
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
