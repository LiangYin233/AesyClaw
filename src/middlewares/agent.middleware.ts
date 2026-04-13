import type { IChannelContext, MiddlewareFunc, PipelineState } from '@/agent/types.js';
import { configManager } from '@/features/config/index.js';
import type { FullConfig } from '@/features/config/schema.js';
import { roleManager } from '@/features/roles/role-manager.js';
import { systemPromptManager } from '@/features/roles/system-prompt-manager.js';
import { DEFAULT_ROLE_ID } from '@/features/roles/types.js';
import type { LLMConfig, ModelCapabilities } from '@/platform/llm/types.js';
import { logger } from '@/platform/observability/logger.js';
import { mapProviderType } from '@/platform/utils/llm-utils.js';
import { parseModelIdentifier } from '@/platform/utils/model-parser.js';
import { getSessionFromContext, getSessionIdFromContext } from './session.middleware.js';

export interface AgentState {
  llmConfig: LLMConfig;
  systemPrompt: string;
  [key: string]: unknown;
}

export function resolveLLMConfig(modelIdentifier: string, config: FullConfig): LLMConfig {
  const { providerName, modelAlias } = parseModelIdentifier(modelIdentifier);

  const providerDetails = config.providers[providerName];
  if (!providerDetails) {
    throw new Error(
      `配置错误：未在 providers 中找到名为 '${providerName}' 的端点配置。`
    );
  }

  const modelConfig = providerDetails.models?.[modelAlias];
  if (!modelConfig) {
    throw new Error(
      `配置错误：在 provider '${providerName}' 中未找到名为 '${modelAlias}' 的模型配置。`
    );
  }

  const capabilities: ModelCapabilities = {
    reasoning: modelConfig.reasoning ?? false,
  };

  return {
    provider: mapProviderType(providerDetails.type),
    model: modelConfig.modelname,
    apiKey: providerDetails.api_key,
    baseUrl: providerDetails.base_url,
    capabilities,
  };
}

export class AgentMiddleware {
  name = 'AgentMiddleware';

  getMiddleware(): MiddlewareFunc {
    return async (ctx: IChannelContext, next: () => Promise<void>) => {
      if (!configManager.isInitialized()) {
        logger.warn({}, 'ConfigManager not initialized, initializing...');
        await configManager.initialize();
      }

      const config = configManager.config;
      const sessionContext = getSessionFromContext(ctx);
      const sessionId = getSessionIdFromContext(ctx);

      if (!sessionContext) {
        logger.error({}, 'SessionContext not found, ensure SessionMiddleware is registered before AgentMiddleware');
        ctx.outbound.text = 'System error: Session not initialized';
        await next();
        return;
      }

      const agent = sessionContext.agent;
      const defaultRole = roleManager.getRoleConfig(DEFAULT_ROLE_ID);
      const modelIdentifier = defaultRole.model;
      const systemPrompt = systemPromptManager.buildSystemPrompt({
        roleId: DEFAULT_ROLE_ID,
        chatId: ctx.inbound.chatId,
      });

      const llmConfig = resolveLLMConfig(modelIdentifier, config);

      if (!ctx.state) {
        ctx.state = {} as PipelineState;
      }

      ctx.state.agent = {
        llmConfig,
        systemPrompt,
      };

      logger.info(
        {
          sessionId,
          chatId: ctx.inbound.chatId,
          channel: sessionContext.metadata.channel,
          type: sessionContext.metadata.type,
          modelIdentifier,
          provider: llmConfig.provider,
          model: llmConfig.model,
        },
        '🤖 Agent middleware: Starting agent processing'
      );

      try {
        let userInput = ctx.inbound.text ?? '';
        const metadata = ctx.inbound.metadata;
        const media = metadata?.media as Array<{ type: string; url: string; filename?: string }> | undefined;

        if (media && Array.isArray(media) && media.length > 0) {
          const mediaDescriptions: string[] = [];

          for (const item of media) {
            if (item.type === 'image') {
              mediaDescriptions.push(`[图片: ${item.url}]`);
            } else if (item.type === 'audio') {
              mediaDescriptions.push(`[语音: ${item.url}]`);
            } else if (item.type === 'file') {
              mediaDescriptions.push(`[文件: ${item.filename || item.url}]`);
            } else if (item.type === 'video') {
              mediaDescriptions.push(`[视频: ${item.url}]`);
            }
          }

          if (mediaDescriptions.length > 0) {
            userInput = `${userInput}\n\n附件信息：\n${mediaDescriptions.join('\n')}`;
          }
        }

        if (!userInput.trim()) {
          ctx.outbound.text = '';
          await next();
          return;
        }

        const result = await agent.run(userInput);

        if (result.success) {
          ctx.outbound.text = result.finalText;
          logger.info({ sessionId, chatId: ctx.inbound.chatId }, 'Agent processing completed');
        } else {
          ctx.outbound.text = `Error: ${result.error}`;
          ctx.outbound.error = result.error;
          logger.error({ sessionId, chatId: ctx.inbound.chatId, error: result.error }, 'Agent processing failed');
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        ctx.outbound.text = `Agent error: ${errorMessage}`;
        ctx.outbound.error = errorMessage;
        logger.error({ sessionId, chatId: ctx.inbound.chatId, error: errorMessage }, 'Agent exception');
      }

      await next();
    };
  }
}

export const agentMiddleware = new AgentMiddleware();

export function getAgentConfigFromContext(ctx: IChannelContext): LLMConfig | null {
  const agentState = ctx.state?.agent;
  if (!agentState) return null;
  return agentState.llmConfig as LLMConfig | null;
}

export function buildLLMConfig(
  modelIdentifier: string,
  config: FullConfig
): LLMConfig {
  return resolveLLMConfig(modelIdentifier, config);
}
