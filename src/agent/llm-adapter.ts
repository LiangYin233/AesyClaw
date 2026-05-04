import { getModel, streamSimple } from '@mariozechner/pi-ai';
import type { Api, KnownProvider, Model } from '@mariozechner/pi-ai';
import type { ConfigManager } from '@aesyclaw/core/config/config-manager';
import type { ProviderConfig } from '@aesyclaw/core/config/schema';
import { createScopedLogger } from '@aesyclaw/core/logger';
import { parseModelIdentifier } from '@aesyclaw/core/utils';
import { requireInitialized } from '@aesyclaw/core/utils';
import type { ResolvedModel, StreamFn, AgentMessage } from './agent-types';
import { API_OPENAI_RESPONSES } from './agent-types';
import { summarizeConversation, analyzeImage, transcribeAudio } from './llm-features';
import type { ImageAnalysisInput, AudioTranscriptionInput } from './llm-features';

const logger = createScopedLogger('llm-adapter');

function makeExtraBodyOnPayload(model: ResolvedModel): ((payload: unknown) => unknown) | undefined {
  const extraBody = model.extraBody;
  if (!extraBody || Object.keys(extraBody).length === 0) {
    return undefined;
  }
  return (payload: unknown) => {
    if (typeof payload === 'object' && payload !== null) {
      return { ...(payload as Record<string, unknown>), ...extraBody };
    }
    return payload;
  };
}

const API_TYPE_MAP: Record<ProviderConfig['apiType'], Api> = {
  openai_responses: API_OPENAI_RESPONSES,
  openai_completion: 'openai-completions',
  anthropic: 'anthropic-messages',
};

export type LlmAdapterDependencies = {
  configManager: ConfigManager;
};

export class LlmAdapter {
  private deps: LlmAdapterDependencies | null = null;

  async initialize(deps: LlmAdapterDependencies): Promise<void> {
    if (this.deps) {
      logger.warn('LlmAdapter 已初始化 — 跳过');
      return;
    }
    this.deps = deps;
    logger.info('LlmAdapter 已初始化');
  }

  destroy(): void {
    this.deps = null;
  }

  private requireDeps(): LlmAdapterDependencies {
    return requireInitialized(this.deps, 'LlmAdapter');
  }

  resolveModel(modelIdentifier: string): ResolvedModel {
    const configManager = this.requireDeps().configManager;

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
    const apiType = API_TYPE_MAP[providerConfig.apiType];
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
      extraBody: preset?.extraBody,
      modelId,
      apiKey,
      apiType,
    };
  }

  createStreamFn(_modelIdentifier: string): StreamFn {
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
    const configManager = this.requireDeps().configManager;

    return (provider: string): string | undefined => {
      const providers = configManager.get('providers');
      const providerConfig = providers[provider];
      return providerConfig?.apiKey;
    };
  }

  async summarize(
    messages: AgentMessage[],
    modelIdentifier: string,
    sessionId?: string,
  ): Promise<string> {
    const model = this.resolveModel(modelIdentifier);
    return await summarizeConversation(model, messages, sessionId, makeExtraBodyOnPayload(model));
  }

  async analyzeImage(
    modelIdentifier: string,
    question: string,
    image: ImageAnalysisInput,
    sessionId?: string,
  ): Promise<string> {
    const model = this.resolveModel(modelIdentifier);
    return await analyzeImage(model, question, image, sessionId, makeExtraBodyOnPayload(model));
  }

  async transcribeAudio(
    modelIdentifier: string,
    audio: AudioTranscriptionInput,
    sessionId?: string,
  ): Promise<string> {
    const model = this.resolveModel(modelIdentifier);
    return await transcribeAudio(model, audio, sessionId);
  }

  private tryGetBuiltInModel(provider: string, modelId: string): Model<Api> | null {
    try {
      return getModel(provider as KnownProvider, modelId as never) as Model<Api>;
    } catch {
      return null;
    }
  }
}
