import { configManager } from '../features/config/index.js';
import { logger } from '../platform/observability/logger.js';
import type { IChannelContext, MiddlewareFunc } from '../agent/core/types.js';
import { AgentManager } from '../agent/core/engine.js';
import { LLMProviderType } from '../agent/llm/types.js';
import { LLMConfig, ModelCapabilities } from '../agent/llm/factory.js';
import { parseModelIdentifier } from '../platform/utils/model-parser.js';
import { roleManager } from '../features/roles/role-manager.js';
import type { FullConfig, CustomProvider, ModelConfig } from '../features/config/schema.js';
import { DEFAULT_ROLE_ID } from '../features/roles/types.js';

export interface AgentState {
  llmConfig: LLMConfig;
  systemPrompt: string;
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
    vision: modelConfig.vision ?? false,
  };

  return {
    provider: mapProviderType(providerDetails.type),
    model: modelConfig.modelname,
    apiKey: providerDetails.api_key,
    baseUrl: providerDetails.base_url,
    maxTokens: modelConfig.maxToken,
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

      const config = configManager.getConfig();

      const defaultRole = roleManager.getRoleConfig(DEFAULT_ROLE_ID);
      const modelIdentifier = defaultRole.model;
      const systemPrompt = defaultRole.system_prompt;

      const llmConfig = resolveLLMConfig(modelIdentifier, config);

      const agentState: AgentState = {
        llmConfig,
        systemPrompt,
      };

      if (!ctx.state) {
        ctx.state = agentState;
      } else {
        Object.assign(ctx.state, agentState);
      }

      logger.debug(
        {
          modelIdentifier,
          provider: llmConfig.provider,
          model: llmConfig.model,
          hasApiKey: !!llmConfig.apiKey,
          hasBaseUrl: !!llmConfig.baseUrl,
          capabilities: llmConfig.capabilities,
          systemPromptLength: systemPrompt.length,
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
  return resolveLLMConfig(modelIdentifier, config);
}
