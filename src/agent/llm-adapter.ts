import {
  getModel,
  streamSimple,
  type Api,
  type KnownProvider,
  type Model,
} from '@mariozechner/pi-ai';
import type { ConfigManager } from '@aesyclaw/core/config/config-manager';
import type { ProviderConfig } from '@aesyclaw/core/config/schema';
import { parseModelIdentifier } from '@aesyclaw/core/utils';
import { makeExtraBodyOnPayload, type ResolvedModel, type StreamFn } from './agent-types';

/**
 * LLM 适配器，负责解析模型配置和创建流式调用函数。
 */
export class LlmAdapter {
  /**
   * @param configManager - 配置管理器
   */
  constructor(private configManager: ConfigManager) {}

  /**
   * 根据模型标识符解析完整的模型配置，包含 API 密钥、上下文窗口、成本等信息。
   *
   * @param modelIdentifier - 模型标识符，例如 "openai/gpt-4o"
   * @returns 解析后的模型配置
   */
  resolveModel(modelIdentifier: string): ResolvedModel {
    const configManager = this.configManager;

    const { provider, modelId } = parseModelIdentifier(modelIdentifier);
    const providers = configManager.get('providers') as Record<string, ProviderConfig>;
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

  /**
   * 创建 PiAgent 使用的流式调用函数。返回的函数在每次调用时从模型配置中提取 API 密钥和额外请求体。
   *
   * @returns 适配 PiAgent StreamFn 接口的函数
   */
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

  /**
   * 尝试从 pi-ai 内置模型库中查找模型。找不到时返回 null。
   *
   * @param provider - 提供者名称
   * @param modelId - 模型标识
   * @returns 内置模型配置，未找到返回 null
   */
  private tryGetBuiltInModel(provider: string, modelId: string): Model<Api> | null {
    try {
      return getModel(provider as KnownProvider, modelId as never) as Model<Api>;
    } catch {
      return null;
    }
  }
}
