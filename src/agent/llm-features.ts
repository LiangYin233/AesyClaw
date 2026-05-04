/**
 * LLM Features — 使用已解析模型的独立 LLM 操作函数。
 *
 * 与 llm-adapter.ts 分开以保持职责单一:
 * - llm-adapter: 模型解析与流式传输
 * - llm-features: 对话总结
 */

import { completeSimple } from '@mariozechner/pi-ai';
import { extractMessageText, makeExtraBodyOnPayload } from './agent-types';
import type { AgentMessage, ResolvedModel } from './agent-types';

export async function summarizeConversation(
  model: ResolvedModel,
  messages: AgentMessage[],
  sessionId?: string,
): Promise<string> {
  const prompt = buildSummaryPrompt(messages);

  const response = await completeSimple(
    model,
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
      messages: [
        {
          role: 'user',
          content: prompt,
          timestamp: Date.now(),
        },
      ],
    },
    {
      apiKey: model.apiKey,
      sessionId,
      onPayload: makeExtraBodyOnPayload(model),
    },
  );

  const summary = extractMessageText(response).trim();
  if (summary.length === 0) {
    throw new Error('LLM 返回了空总结');
  }

  return summary;
}

function buildSummaryPrompt(messages: AgentMessage[]): string {
  const transcript = messages
    .map((message) => `${message.role.toUpperCase()}: ${extractMessageText(message).trim()}`)
    .filter((line) => !line.endsWith(':'))
    .join('\n\n');

  return ['Conversation transcript:', '', transcript].join('\n');
}
