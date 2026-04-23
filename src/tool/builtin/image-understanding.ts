/**
 * Built-in image_understanding tool.
 *
 * Analyzes an image from a URL or file path. Stub until LlmAdapter
 * is implemented.
 *
 * @see project.md §5.15
 */

import { Type, Static } from '@sinclair/typebox';
import type { AesyClawTool, ToolExecutionContext, ToolExecutionResult } from '../tool-registry';
import type { ToolOwner } from '../../core/types';

/** Parameter schema for image_understanding */
const ImageUnderstandingParamsSchema = Type.Object({
  source: Type.String({ description: '图片来源：URL 或本地文件路径' }),
  question: Type.Optional(Type.String({ description: '对图片提出的问题' })),
});

type ImageUnderstandingParams = Static<typeof ImageUnderstandingParamsSchema>;

/** Dependencies needed by image_understanding (typed as unknown until LlmAdapter is implemented) */
export interface ImageUnderstandingDeps {
  /** Will be LlmAdapter when implemented */
  llmAdapter: unknown;
}

export function createImageUnderstandingTool(_deps: ImageUnderstandingDeps): AesyClawTool {
  return {
    name: 'image_understanding',
    description: '分析图片内容，可针对图片提出问题',
    parameters: ImageUnderstandingParamsSchema,
    owner: 'system' as ToolOwner,
    execute: async (_params: unknown, _context: ToolExecutionContext): Promise<ToolExecutionResult> => {
      // Stub — depends on LlmAdapter for actual image analysis
      return {
        content: 'Image analysis not available — vision service not yet connected.',
        isError: true,
      };
    },
  };
}