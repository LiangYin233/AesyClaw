/**
 * LLM Features — 使用已解析模型的独立 LLM 操作函数。
 *
 * 与 llm-adapter.ts 分开以保持职责单一:
 * - llm-adapter: 模型解析与流式传输
 * - llm-features: 对话总结 / 图片分析 / 音频转写
 */

import { completeSimple } from '@mariozechner/pi-ai';
import { extractMessageText } from './agent-types';
import type { AgentMessage, ResolvedModel } from './agent-types';
import type { ImageAnalysisInput, AudioTranscriptionInput } from './llm-adapter';

export async function summarizeConversation(
  model: ResolvedModel,
  messages: AgentMessage[],
  sessionId?: string,
  onPayload?: (payload: unknown) => unknown,
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
      onPayload,
    },
  );

  const summary = extractMessageText(response).trim();
  if (summary.length === 0) {
    throw new Error('LLM 返回了空总结');
  }

  return summary;
}

export async function analyzeImage(
  model: ResolvedModel,
  question: string,
  image: ImageAnalysisInput,
  sessionId?: string,
  onPayload?: (payload: unknown) => unknown,
): Promise<string> {
  if (!model.input.includes('image')) {
    throw new Error(`配置的模型 "${model.modelId}" 不支持图像输入`);
  }

  const response = await completeSimple(
    model,
    {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: question },
            { type: 'image', data: image.data, mimeType: image.mimeType },
          ],
          timestamp: Date.now(),
        },
      ],
    },
    {
      apiKey: model.apiKey,
      sessionId,
      onPayload,
    },
  );

  const answer = extractMessageText(response).trim();
  if (answer.length === 0) {
    throw new Error('LLM 返回了空图像分析回复');
  }

  return answer;
}

export async function transcribeAudio(
  model: ResolvedModel,
  audio: AudioTranscriptionInput,
  sessionId?: string,
): Promise<string> {
  if (model.apiType !== 'openai-responses' && model.apiType !== 'openai-completions') {
    throw new Error(`提供者 API 类型 "${model.apiType}" 不支持语音转文本`);
  }

  if (!model.apiKey) {
    throw new Error(`未为语音转文本提供者 "${model.provider}" 配置 API 密钥`);
  }

  const endpoint = new URL('audio/transcriptions', getProviderBaseUrl(model)).toString();
  const formData = new FormData();
  formData.append('model', model.id);
  formData.append(
    'file',
    new File([Buffer.from(audio.data)], audio.fileName, { type: audio.mimeType }),
  );

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${model.apiKey}`,
      ...(sessionId ? { 'x-session-id': sessionId } : {}),
    },
    body: formData,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`语音转文本请求失败 (${response.status}): ${body || response.statusText}`);
  }

  const payload = (await response.json()) as { text?: unknown };
  const text = typeof payload.text === 'string' ? payload.text.trim() : '';

  if (text.length === 0) {
    throw new Error('语音转文本响应未包含转录文本');
  }

  return text;
}

function buildSummaryPrompt(messages: AgentMessage[]): string {
  const transcript = messages
    .map((message) => `${message.role.toUpperCase()}: ${extractMessageText(message).trim()}`)
    .filter((line) => !line.endsWith(':'))
    .join('\n\n');

  return ['Conversation transcript:', '', transcript].join('\n');
}

function getProviderBaseUrl(model: ResolvedModel): string {
  if (model.baseUrl.trim().length > 0) {
    const url = model.baseUrl;
    return url.endsWith('/') ? url : `${url}/`;
  }

  throw new Error(`未为提供者 "${model.provider}" 配置 base URL`);
}
