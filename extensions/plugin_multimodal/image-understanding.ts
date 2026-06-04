/**
 * plugin_multimodal/image-understanding — 图片理解工具。
 *
 * 插件 init() 通过 ctx.models.resolve() 注入模型解析器，
 * 工具直接调用 LLM 完成图片分析。
 */

import { Type } from '@sinclair/typebox';
import { completeSimple } from '@earendil-works/pi-ai';
import { extractMessageText, makeExtraBodyOnPayload } from '@aesyclaw/contracts/llm';
import type { ResolvedModel } from '@aesyclaw/contracts/llm';
import type { AesyClawTool, ToolExecutionContext, ToolExecutionResult } from '@aesyclaw/sdk';
import { loadMediaSource } from './media-utils';

const SCHEMA = Type.Object({
  source: Type.String({
    description: '图片来源：data URI (data:image/jpeg;base64,...)、URL 或本地文件路径',
  }),
  question: Type.Optional(Type.String({ description: '对图片提出的问题' })),
});

export type ImageUnderstandingConfig = {
  provider: string;
  model: string;
};

export function createImageUnderstandingTool(
  resolveModel: (id: string) => ResolvedModel,
  config: ImageUnderstandingConfig,
): AesyClawTool {
  return {
    name: 'image_understanding',
    description: '分析图片内容，可针对图片提出问题（支持 data URI、URL 或本地文件路径）',
    parameters: SCHEMA,
    owner: 'plugin:multimodal',
    execute: async (params: unknown, ctx: ToolExecutionContext): Promise<ToolExecutionResult> => {
      const { source, question } = params as { source: string; question?: string };
      try {
        const image = await loadMediaSource(source);
        const model = resolveModel(`${config.provider}/${config.model}`) as ResolvedModel;

        if (!model.input.includes('image'))
          throw new Error(`配置的模型 "${model.modelId}" 不支持图像输入`);

        const sid = `${ctx.sessionKey.channel}:${ctx.sessionKey.type}:${ctx.sessionKey.chatId}`;
        const resp = await completeSimple(
          model,
          {
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: question ?? '详细描述这张图片。' },
                  { type: 'image', data: image.base64, mimeType: image.mimeType },
                ],
                timestamp: Date.now(),
              },
            ],
          },
          { apiKey: model.apiKey, sessionId: sid, onPayload: makeExtraBodyOnPayload(model) },
        );

        const answer = extractMessageText(resp).trim();
        if (!answer) throw new Error('LLM 返回了空图像分析回复');

        return { content: answer };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { content: `图片理解失败: ${message}`, isError: true };
      }
    },
  };
}
