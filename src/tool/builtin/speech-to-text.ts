import { Type } from '@sinclair/typebox';
import type {
  AesyClawTool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '@aesyclaw/tool/tool-registry';
import { errorMessage, loadMediaSource } from '@aesyclaw/core/utils';
import { ApiType } from '@aesyclaw/agent/agent-types';
import type { ToolOwner } from '@aesyclaw/core/types';
import type { ConfigManager } from '@aesyclaw/core/config/config-manager';
import type { LlmAdapter } from '@aesyclaw/agent/llm-adapter';

const SPEECH_TO_TEXT_SCHEMA = Type.Object({
  source: Type.String({
    description: '音频来源：data URI (data:audio/mpeg;base64,...)、URL 或本地文件路径',
  }),
});

/**
 * 创建 speech_to_text 工具定义。
 *
 * 使用配置的语音转文本模型将音频转录为文本，支持 data URI、URL 或本地文件路径。
 *
 * @param deps - 依赖项，包含 configManager 和 llmAdapter
 * @returns speech_to_text 工具的 AesyClawTool 定义
 */
export function createSpeechToTextTool(deps: {
  configManager: Pick<ConfigManager, 'get'>;
  llmAdapter: Pick<LlmAdapter, 'resolveModel'>;
}): AesyClawTool {
  return {
    name: 'speech_to_text',
    description: '将音频转录为文本（支持 data URI、URL 或本地文件路径）',
    parameters: SPEECH_TO_TEXT_SCHEMA,
    owner: 'system' as ToolOwner,
    execute: async (params: unknown, ctx: ToolExecutionContext): Promise<ToolExecutionResult> => {
      const { source } = params as { source: string };
      try {
        const audio = await loadMediaSource(source);
        const mm = deps.configManager.get('agent.multimodal') as {
          speechToText: { provider: string; model: string };
        };
        const model = deps.llmAdapter.resolveModel(
          `${mm.speechToText.provider}/${mm.speechToText.model}`,
        );
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
        return { content: `语音转文本失败: ${errorMessage(e)}`, isError: true };
      }
    },
  };
}
