/**
 * Built-in speech_to_text tool.
 *
 * Transcribes audio from a URL or file path. Stub until LlmAdapter
 * is implemented.
 *
 * @see project.md §5.15
 */

import { Type, Static } from '@sinclair/typebox';
import type { AesyClawTool, ToolExecutionContext, ToolExecutionResult } from '../tool-registry';
import type { ToolOwner } from '../../core/types';

/** Parameter schema for speech_to_text */
const SpeechToTextParamsSchema = Type.Object({
  source: Type.String({ description: '音频来源：URL 或本地文件路径' }),
});

type SpeechToTextParams = Static<typeof SpeechToTextParamsSchema>;

/** Dependencies needed by speech_to_text (typed as unknown until LlmAdapter is implemented) */
export interface SpeechToTextDeps {
  /** Will be LlmAdapter when implemented */
  llmAdapter: unknown;
}

export function createSpeechToTextTool(_deps: SpeechToTextDeps): AesyClawTool {
  return {
    name: 'speech_to_text',
    description: '将音频转录为文本（支持 URL 或本地文件路径）',
    parameters: SpeechToTextParamsSchema,
    owner: 'system' as ToolOwner,
    execute: async (_params: unknown, _context: ToolExecutionContext): Promise<ToolExecutionResult> => {
      // Stub — depends on LlmAdapter for actual STT
      return {
        content: 'Transcription not available — speech-to-text service not yet connected.',
        isError: true,
      };
    },
  };
}