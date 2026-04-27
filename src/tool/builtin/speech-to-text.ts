/**
 * Built-in speech_to_text tool.
 *
 * Transcribes audio from a URL or file path.
 *
 */

import type { Static } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';
import type { AesyClawTool, ToolExecutionContext, ToolExecutionResult } from '../tool-registry';
import type { ToolOwner } from '../../core/types';
import type { ConfigManager } from '../../core/config/config-manager';
import type { LlmAdapter } from '../../agent/llm-adapter';
import { loadMediaSource } from './media-source';

/** Parameter schema for speech_to_text */
const SpeechToTextParamsSchema = Type.Object({
  source: Type.String({ description: '音频来源：URL 或本地文件路径' }),
});

type SpeechToTextParams = Static<typeof SpeechToTextParamsSchema>;

export interface SpeechToTextDeps {
  configManager: Pick<ConfigManager, 'get'>;
  llmAdapter: Pick<LlmAdapter, 'transcribeAudio'>;
}

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
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: `Speech-to-text failed: ${message}`,
          isError: true,
        };
      }
    },
  };
}
