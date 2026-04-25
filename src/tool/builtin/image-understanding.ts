/**
 * Built-in image_understanding tool.
 *
 * Analyzes an image from a URL or file path.
 *
 */

import type { Static } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';
import type { AesyClawTool, ToolExecutionContext, ToolExecutionResult } from '../tool-registry';
import type { ToolOwner } from '../../core/types';
import type { ConfigManager } from '../../core/config/config-manager';
import type { LlmAdapter } from '../../agent/llm-adapter';
import { loadMediaSource } from './media-source';

/** Parameter schema for image_understanding */
const ImageUnderstandingParamsSchema = Type.Object({
  source: Type.String({ description: '图片来源：URL 或本地文件路径' }),
  question: Type.Optional(Type.String({ description: '对图片提出的问题' })),
});

type ImageUnderstandingParams = Static<typeof ImageUnderstandingParamsSchema>;

export interface ImageUnderstandingDeps {
  configManager: Pick<ConfigManager, 'get'>;
  llmAdapter: Pick<LlmAdapter, 'analyzeImage'>;
}

export function createImageUnderstandingTool(deps: ImageUnderstandingDeps): AesyClawTool {
  return {
    name: 'image_understanding',
    description: '分析图片内容，可针对图片提出问题',
    parameters: ImageUnderstandingParamsSchema,
    owner: 'system' as ToolOwner,
    execute: async (
      params: unknown,
      context: ToolExecutionContext,
    ): Promise<ToolExecutionResult> => {
      const { source, question } = params as ImageUnderstandingParams;

      try {
        const image = await loadMediaSource(source, 'image');
        const multimodal = deps.configManager.get('multimodal');
        const modelIdentifier = `${multimodal.imageUnderstanding.provider}/${multimodal.imageUnderstanding.model}`;
        const answer = await deps.llmAdapter.analyzeImage(
          modelIdentifier,
          question ?? 'Describe this image in detail.',
          { data: image.base64, mimeType: image.mimeType },
          `${context.sessionKey.channel}:${context.sessionKey.type}:${context.sessionKey.chatId}`,
        );

        return { content: answer };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: `Image understanding failed: ${message}`,
          isError: true,
        };
      }
    },
  };
}
