import { configManager } from '../features/config/index.js';
import { logger } from '../platform/observability/logger.js';
import type { IChannelContext, MiddlewareFunc } from '../agent/core/types.js';
import { AgentManager } from '../agent/core/engine.js';
import { LLMProviderType } from '../agent/llm/types.js';
import { LLMConfig } from '../agent/llm/factory.js';
import { parseModelIdentifier } from '../platform/utils/model-parser.js';
import type { FullConfig, CustomProvider } from '../features/config/schema.js';

export interface AgentState {
  llmConfig: LLMConfig;
  [key: string]: unknown;
}

export function mapProviderType(type: string): LLMProviderType {
  switch (type) {
    case 'openai_chat':
      return LLMProviderType.OpenAIChat;
    case 'openai_completion':
      return LLMProviderType.OpenAICompletion;
    case 'anthropic':
      return LLMProviderType.Anthropic;
    default:
      logger.warn({ type }, 'Unknown provider type, defaulting to OpenAI Chat');
      return LLMProviderType.OpenAIChat;
  }
}

export class AgentMiddleware {
  name = 'AgentMiddleware';

  getMiddleware(): MiddlewareFunc {
    return async (ctx: IChannelContext, next: () => Promise<void>) => {
      const config = configManager.getConfig();

      const modelIdentifier = config.agent.default_model;
      const { providerName, modelName } = parseModelIdentifier(modelIdentifier);

      const providerDetails = config.providers[providerName];
      if (!providerDetails) {
        throw new Error(
          `配置错误：未在 providers 中找到名为 '${providerName}' 的端点配置。`
        );
      }

      const llmConfig: LLMConfig = {
        provider: mapProviderType(providerDetails.type),
        model: modelName,
        apiKey: providerDetails.api_key,
        baseUrl: providerDetails.base_url,
        temperature: providerDetails.temperature ?? config.agent.default_temperature,
        maxTokens: providerDetails.max_tokens ?? config.agent.default_max_tokens,
      };

      const agentState: AgentState = { llmConfig };

      if (!ctx.state) {
        ctx.state = agentState;
      } else {
        Object.assign(ctx.state, agentState);
      }

      logger.debug(
        {
          modelIdentifier,
          providerName,
          modelName,
          providerType: llmConfig.provider,
          hasApiKey: !!llmConfig.apiKey,
          hasBaseUrl: !!llmConfig.baseUrl,
        },
        'Agent middleware: LLM config resolved'
      );

      await next();
    };
  }
}

export const agentMiddleware = new AgentMiddleware();

export function getAgentConfigFromContext(ctx: IChannelContext): LLMConfig | null {
  const agentState = ctx.state as unknown as AgentState;
  return agentState?.llmConfig || null;
}

export function buildLLMConfig(
  modelIdentifier: string,
  config: FullConfig
): LLMConfig {
  const { providerName, modelName } = parseModelIdentifier(modelIdentifier);

  const providerDetails = config.providers[providerName];
  if (!providerDetails) {
    throw new Error(
      `配置错误：未在 providers 中找到名为 '${providerName}' 的端点配置。`
    );
  }

  return {
    provider: mapProviderType(providerDetails.type),
    model: modelName,
    apiKey: providerDetails.api_key,
    baseUrl: providerDetails.base_url,
    temperature: providerDetails.temperature ?? config.agent.default_temperature,
    maxTokens: providerDetails.max_tokens ?? config.agent.default_max_tokens,
  };
}
