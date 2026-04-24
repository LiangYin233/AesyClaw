import { getModel, streamSimple } from '@mariozechner/pi-ai';
import type { Api, KnownProvider, Model } from '@mariozechner/pi-ai';
import type { ConfigManager } from '../core/config/config-manager';
import type { ProviderConfig } from '../core/config/schema';
import { createScopedLogger } from '../core/logger';
import { extractMessageText } from './agent-types';
import type { ResolvedModel, StreamFn, AgentMessage } from './agent-types';

const logger = createScopedLogger('llm-adapter');

const API_TYPE_MAP = {
  openai_responses: 'openai-responses',
  openai_completion: 'openai-completions',
  anthropic: 'anthropic-messages',
} as const satisfies Record<ProviderConfig['apiType'], Api>;

export interface LlmAdapterDependencies {
  configManager: ConfigManager;
}

export class LlmAdapter {
  private configManager: ConfigManager | null = null;
  private initialized = false;

  initialize(deps: LlmAdapterDependencies): void {
    if (this.initialized) {
      logger.warn('LlmAdapter already initialized — skipping');
      return;
    }
    this.configManager = deps.configManager;
    this.initialized = true;
    logger.info('LlmAdapter initialized');
  }

  resolveModel(modelIdentifier: string): ResolvedModel {
    if (!this.configManager) {
      throw new Error('LlmAdapter not initialized');
    }

    const slashIndex = modelIdentifier.indexOf('/');
    if (slashIndex === -1) {
      throw new Error(
        `Invalid model identifier format: "${modelIdentifier}". Expected "provider/modelId".`,
      );
    }

    const provider = modelIdentifier.substring(0, slashIndex);
    const modelId = modelIdentifier.substring(slashIndex + 1);
    const providers = this.configManager.get('providers');
    const providerConfig: ProviderConfig | undefined = providers[provider];

    if (!providerConfig) {
      const configuredProviders = Object.keys(providers);
      const hint = configuredProviders.length
        ? `Available providers: ${configuredProviders.join(', ')}`
        : 'No providers are configured. Add a provider entry under config.json > providers.';

      throw new Error(`Provider "${provider}" not found in config. ${hint}`);
    }

    const preset = providerConfig.models?.[modelId];
    const apiType = API_TYPE_MAP[providerConfig.apiType];
    const realModelName = preset?.realModelName;
    const effectiveModelId = realModelName ?? modelId;
    const builtInModel = this.tryGetBuiltInModel(provider, effectiveModelId);

    return {
      id: effectiveModelId,
      name: builtInModel?.name ?? effectiveModelId,
      provider,
      api: apiType,
      baseUrl: providerConfig.baseUrl ?? builtInModel?.baseUrl ?? '',
      reasoning: preset?.enableThinking ?? builtInModel?.reasoning ?? false,
      input: builtInModel?.input ?? ['text'],
      cost: builtInModel?.cost ?? {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      },
      contextWindow: preset?.contextWindow ?? builtInModel?.contextWindow ?? 128000,
      maxTokens: builtInModel?.maxTokens ?? 8192,
      headers: builtInModel?.headers,
      compat: builtInModel?.compat,
      modelId,
      realModelName,
      apiKey: preset?.apiKey ?? providerConfig.apiKey,
      apiType,
    };
  }

  createStreamFn(_modelIdentifier: string): StreamFn {
    return (model, context, options) => {
      const runtimeModel = model as ResolvedModel;
      return streamSimple(runtimeModel, context, {
        ...options,
        apiKey: runtimeModel.apiKey ?? options?.apiKey,
      });
    };
  }

  createGetApiKey(): (provider: string) => string | undefined {
    if (!this.configManager) {
      throw new Error('LlmAdapter not initialized');
    }

    const configManager = this.configManager;

    return (provider: string): string | undefined => {
      const providers = configManager.get('providers');
      const providerConfig = providers[provider];
      return providerConfig?.apiKey;
    };
  }

  async summarize(messages: AgentMessage[]): Promise<string> {
    const userMessages = messages.filter((message) => message.role === 'user').length;
    const assistantMessages = messages.filter((message) => message.role === 'assistant').length;
    const preview = messages
      .map((message) => `${message.role}: ${extractMessageText(message)}`)
      .filter((line) => line.trim().length > 0)
      .slice(-4)
      .join(' | ');

    logger.debug(`Summarizing ${messages.length} messages (stub)`);

    return `Conversation summary: ${messages.length} messages (${userMessages} user, ${assistantMessages} assistant). This is a stub summary — real implementation will use the LLM. Recent context: ${preview}`;
  }

  private tryGetBuiltInModel(provider: string, modelId: string): Model<Api> | null {
    try {
      return getModel(provider as KnownProvider, modelId as never) as Model<Api>;
    } catch {
      return null;
    }
  }
}
