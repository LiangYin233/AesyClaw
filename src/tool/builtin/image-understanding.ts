/**
 * 内置 image_understanding 工具。
 *
 * 分析来自 URL 或文件路径的图片。
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
import { loadMediaSource } from './media-source';

/** image_understanding 的参数模式 */
const ImageUnderstandingParamsSchema = Type.Object({
  source: Type.String({ description: '图片来源：URL 或本地文件路径' }),
  question: Type.Optional(Type.String({ description: '对图片提出的问题' })),
});

type ImageUnderstandingParams = Static<typeof ImageUnderstandingParamsSchema>;

export type ImageUnderstandingDeps = {
  configManager: Pick<ConfigManager, 'get'>;
  llmAdapter: Pick<LlmAdapter, 'analyzeImage'>;
};

/**
 * 创建 image_understanding 工具定义。
 *
 * @param deps - 包含 configManager 和 llmAdapter 的依赖项
 * @returns image_understanding 工具的 AesyClawTool 定义
 */
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
        const multimodal = deps.configManager.get('agent').multimodal;
        const modelIdentifier = `${multimodal.imageUnderstanding.provider}/${multimodal.imageUnderstanding.model}`;
        const answer = await deps.llmAdapter.analyzeImage(
          modelIdentifier,
          question ?? '详细描述这张图片。',
          { data: image.base64, mimeType: image.mimeType },
          `${context.sessionKey.channel}:${context.sessionKey.type}:${context.sessionKey.chatId}`,
        );

        return { content: answer };
      } catch (error: unknown) {
        return {
          content: `图片理解失败: ${errorMessage(error)}`,
          isError: true,
        };
      }
    },
  };
}
