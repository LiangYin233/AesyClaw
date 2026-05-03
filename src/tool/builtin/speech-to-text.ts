/**
 * 内置 speech_to_text 工具。
 *
 * 转录来自 URL 或文件路径的音频。
 *
 */

import type { Static } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';
import type { AesyClawTool, ToolExecutionContext, ToolExecutionResult } from '@aesyclaw/tool/tool-registry';
import { errorMessage } from '@aesyclaw/core/utils';
import type { ToolOwner } from '@aesyclaw/core/types';
import type { ConfigManager } from '@aesyclaw/core/config/config-manager';
import type { LlmAdapter } from '@aesyclaw/agent/llm-adapter';
import { loadMediaSource } from './media-source';

/** speech_to_text 的参数模式 */
const SpeechToTextParamsSchema = Type.Object({
  source: Type.String({ description: '音频来源：URL 或本地文件路径' }),
});

type SpeechToTextParams = Static<typeof SpeechToTextParamsSchema>;

export type SpeechToTextDeps = {
  configManager: Pick<ConfigManager, 'get'>;
  llmAdapter: Pick<LlmAdapter, 'transcribeAudio'>;
};

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
        const transcription = await deps.llmAdapter.transcribeAudio(
          modelIdentifier,
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
