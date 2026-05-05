import { getModel, streamSimple } from '@mariozechner/pi-ai';
import type { Api, KnownProvider, Model } from '@mariozechner/pi-ai';
import type { ConfigManager } from '@aesyclaw/core/config/config-manager';
import type { ProviderConfig } from '@aesyclaw/core/config/schema';
import { parseModelIdentifier } from '@aesyclaw/core/utils';
import type { ResolvedModel, StreamFn } from './agent-types';
import { makeExtraBodyOnPayload } from './agent-types';

export class LlmAdapter {
  constructor(private configManager: ConfigManager) {}

  resolveModel(modelIdentifier: string): ResolvedModel {
    const configManager = this.configManager;

    const { provider, modelId } = parseModelIdentifier(modelIdentifier);
    const providers = configManager.get('providers');
    const providerConfig: ProviderConfig | undefined = providers[provider];

    if (providerConfig === undefined) {
      const configuredProviders = Object.keys(providers);
      const hint = configuredProviders.length
        ? `可用提供者: ${configuredProviders.join(', ')}`
        : '未配置任何提供者。请在 config.json > providers 下添加提供者条目。';

      throw new Error(`配置中未找到提供者 "${provider}"。${hint}`);
    }

    const preset = providerConfig.models?.[modelId];
    const apiType = providerConfig.apiType;
    const builtInModel = this.tryGetBuiltInModel(provider, modelId);
    const apiKey = providerConfig.apiKey;

    if (!apiKey) {
      throw new Error(
        `未为提供者 "${provider}" 配置 API 密钥。请在 config.json > providers.${provider} 下添加 apiKey。`,
      );
    }

    return {
      id: modelId,
      name: builtInModel?.name ?? modelId,
      provider,
      api: apiType,
      baseUrl: providerConfig.baseUrl ?? builtInModel?.baseUrl ?? '',
      reasoning: builtInModel?.reasoning ?? false,
      input: (preset?.input ?? builtInModel?.input ?? ['text']) as ResolvedModel['input'],
      cost: builtInModel?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: preset?.contextWindow ?? builtInModel?.contextWindow ?? 128000,
      maxTokens: builtInModel?.maxTokens ?? 8192,
      headers: builtInModel?.headers,
      compat: builtInModel?.compat,
      extraBody: preset?.extraBody,
      modelId,
      apiKey,
      apiType,
    };
  }

  createStreamFn(): StreamFn {
    return (model, context, options) => {
      const runtimeModel = model as ResolvedModel;
      if (!runtimeModel.apiKey) {
        throw new Error(
          `未为提供者 "${runtimeModel.provider}" 配置 API 密钥。请在 config.json > providers.${runtimeModel.provider} 下添加 apiKey。`,
        );
      }
      return streamSimple(runtimeModel, context, {
        ...options,
        apiKey: runtimeModel.apiKey,
        onPayload: makeExtraBodyOnPayload(runtimeModel),
      });
    };
  }

  createGetApiKey(): (provider: string) => string | undefined {
    return (provider: string): string | undefined => {
      const providers = this.configManager.get('providers');
      const providerConfig = providers[provider];
      return providerConfig?.apiKey;
    };
  }

  private tryGetBuiltInModel(provider: string, modelId: string): Model<Api> | null {
    try {
      return getModel(provider as KnownProvider, modelId as never) as Model<Api>;
    } catch {
      return null;
    }
  }
}
