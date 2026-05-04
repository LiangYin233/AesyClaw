/**
 * 内置 speech_to_text 工具。
 *
 * 转录来自 URL 或文件路径的音频。
 *
 */

import type { Static } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';
import type {
  AesyClawTool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '@aesyclaw/tool/tool-registry';
import { errorMessage } from '@aesyclaw/core/utils';
import type { ToolOwner } from '@aesyclaw/core/types';
import type { ConfigManager } from '@aesyclaw/core/config/config-manager';
import type { LlmAdapter } from '@aesyclaw/agent/llm-adapter';
import { ApiType } from '@aesyclaw/agent/agent-types';
import type { ResolvedModel } from '@aesyclaw/agent/agent-types';
import { loadMediaSource } from './media-source';

/** speech_to_text 的参数模式 */
const SpeechToTextParamsSchema = Type.Object({
  source: Type.String({ description: '音频来源：URL 或本地文件路径' }),
});

type SpeechToTextParams = Static<typeof SpeechToTextParamsSchema>;

export type SpeechToTextDeps = {
  configManager: Pick<ConfigManager, 'get'>;
  llmAdapter: Pick<LlmAdapter, 'resolveModel'>;
};

type AudioTranscriptionInput = {
  data: Uint8Array;
  mimeType: string;
  fileName: string;
};

function getProviderBaseUrl(model: ResolvedModel): string {
  if (model.baseUrl.trim().length > 0) {
    const url = model.baseUrl;
    return url.endsWith('/') ? url : `${url}/`;
  }

  throw new Error(`未为提供者 "${model.provider}" 配置 base URL`);
}

async function transcribeAudio(
  model: ResolvedModel,
  audio: AudioTranscriptionInput,
  sessionId?: string,
): Promise<string> {
  if (model.apiType !== ApiType.OPENAI_RESPONSES && model.apiType !== ApiType.OPENAI_COMPLETIONS) {
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

/**
 * 创建 speech_to_text 工具定义。
 *
 * @param deps - 包含 configManager 和 llmAdapter 的依赖项
 * @returns speech_to_text 工具的 AesyClawTool 定义
 */
export function createSpeechToTextTool(deps: SpeechToTextDeps): AesyClawTool {
  return {
    name: 'speech_to_text',
    description: '将音频转录为文本（支持 URL 或本地文件路径）',
    parameters: SpeechToTextParamsSchema,
    owner: 'system' as ToolOwner,
    execute: async (
      params: unknown,
      context: ToolExecutionContext,
    ): Promise<ToolExecutionResult> => {
      const { source } = params as SpeechToTextParams;

      try {
        const audio = await loadMediaSource(source, 'audio');
        const multimodal = deps.configManager.get('agent').multimodal;
        const modelIdentifier = `${multimodal.speechToText.provider}/${multimodal.speechToText.model}`;
        const model = deps.llmAdapter.resolveModel(modelIdentifier);
        const transcription = await transcribeAudio(
          model,
          {
            data: audio.data,
            mimeType: audio.mimeType,
            fileName: audio.fileName,
          },
          `${context.sessionKey.channel}:${context.sessionKey.type}:${context.sessionKey.chatId}`,
        );

        return { content: transcription };
      } catch (error: unknown) {
        return {
          content: `语音转文本失败: ${errorMessage(error)}`,
          isError: true,
        };
      }
    },
  };
}
