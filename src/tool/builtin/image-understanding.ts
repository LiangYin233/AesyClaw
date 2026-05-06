import { Type } from '@sinclair/typebox';
import type {
  AesyClawTool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '@aesyclaw/tool/tool-registry';
import { errorMessage, loadMediaSource } from '@aesyclaw/core/utils';
import { extractMessageText, makeExtraBodyOnPayload } from '@aesyclaw/agent/agent-types';
import { completeSimple } from '@mariozechner/pi-ai';
import type { ToolOwner } from '@aesyclaw/core/types';
import type { ConfigManager } from '@aesyclaw/core/config/config-manager';
import type { LlmAdapter } from '@aesyclaw/agent/llm-adapter';
import type { ResolvedModel } from '@aesyclaw/agent/agent-types';

export function createImageUnderstandingTool(deps: {
  configManager: Pick<ConfigManager, 'get'>;
  llmAdapter: Pick<LlmAdapter, 'resolveModel'>;
  usageRepository?: {
    create: (record: {
      model: string;
      provider: string;
      api: string;
      responseId?: string;
      usage: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
        totalTokens: number;
      };
    }) => Promise<number>;
  };
}): AesyClawTool {
  return {
    name: 'image_understanding',
    description: '分析图片内容，可针对图片提出问题（支持 data URI、URL 或本地文件路径）',
    parameters: Type.Object({
      source: Type.String({
        description: '图片来源：data URI (data:image/jpeg;base64,...)、URL 或本地文件路径',
      }),
      question: Type.Optional(Type.String({ description: '对图片提出的问题' })),
    }),
    owner: 'system' as ToolOwner,
    execute: async (params: unknown, ctx: ToolExecutionContext): Promise<ToolExecutionResult> => {
      const { source, question } = params as { source: string; question?: string };
      try {
        const image = await loadMediaSource(source);
        const mm = deps.configManager.get('agent').multimodal;
        const model = deps.llmAdapter.resolveModel(
          `${mm.imageUnderstanding.provider}/${mm.imageUnderstanding.model}`,
        ) as ResolvedModel;
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
        if (deps.usageRepository && resp.usage?.totalTokens > 0) {
          deps.usageRepository
            .create({
              model: resp.model,
              provider: resp.provider,
              api: resp.api as string,
              responseId: resp.responseId,
              usage: resp.usage,
            })
            .catch(() => {});
        }
        return { content: answer };
      } catch (e) {
        return { content: `图片理解失败: ${errorMessage(e)}`, isError: true };
      }
    },
  };
}
