/**
 * plugin_multimodal/speech-to-text — 语音转文本工具。
 *
 * 插件 init() 通过 ctx.models.resolve() 注入模型解析器，
 * 工具直接调用 OpenAI 兼容的 audio/transcriptions API。
 */

import { Type } from '@sinclair/typebox';
import { ApiType } from '@aesyclaw/contracts/llm';
import type { ResolvedModel } from '@aesyclaw/contracts/llm';
import type { AesyClawTool, ToolExecutionContext, ToolExecutionResult } from '@aesyclaw/sdk';
import { loadMediaSource } from './media-utils';

const SCHEMA = Type.Object({
  source: Type.String({
    description: '音频来源：data URI (data:audio/mpeg;base64,...)、URL 或本地文件路径',
  }),
});

export type SpeechToTextConfig = {
  provider: string;
  model: string;
};

export function createSpeechToTextTool(
  resolveModel: (id: string) => ResolvedModel,
  config: SpeechToTextConfig,
): AesyClawTool {
  return {
    name: 'speech_to_text',
    description: '将音频转录为文本（支持 data URI、URL 或本地文件路径）',
    parameters: SCHEMA,
    owner: 'plugin:multimodal',
    execute: async (params: unknown, ctx: ToolExecutionContext): Promise<ToolExecutionResult> => {
      const { source } = params as { source: string };
      try {
        const audio = await loadMediaSource(source);
        const model = resolveModel(`${config.provider}/${config.model}`);

        if (
          model.apiType !== ApiType.OPENAI_RESPONSES &&
          model.apiType !== ApiType.OPENAI_COMPLETIONS
        )
          throw new Error(`提供者 API 类型 "${model.apiType}" 不支持语音转文本`);

        if (!model.apiKey)
          throw new Error(`未为语音转文本提供者 "${model.provider}" 配置 API 密钥`);

        const baseUrl = model.baseUrl.trim();
        const endpoint = new URL(
          'audio/transcriptions',
          baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`,
        ).toString();

        const fd = new FormData();
        fd.append('model', model.id);
        fd.append(
          'file',
          new File([Buffer.from(audio.data)], audio.fileName, { type: audio.mimeType }),
        );

        const sid = `${ctx.sessionKey.channel}:${ctx.sessionKey.type}:${ctx.sessionKey.chatId}`;
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${model.apiKey}`,
            ...(sid ? { 'x-session-id': sid } : {}),
          },
          body: fd,
        });

        if (!res.ok) {
          const body = await res.text();
          throw new Error(`语音转文本请求失败 (${res.status}): ${body || res.statusText}`);
        }

        const payload = (await res.json()) as { text?: unknown };
        const text = typeof payload.text === 'string' ? payload.text.trim() : '';
        if (!text) throw new Error('语音转文本响应未包含转录文本');

        return { content: text };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { content: `语音转文本失败: ${message}`, isError: true };
      }
    },
  };
}
