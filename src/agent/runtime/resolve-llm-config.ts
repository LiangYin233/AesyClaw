import type { FullConfig } from '@/features/config/schema.js';
import { LLMProviderType, type LLMConfig, type ModelCapabilities } from '@/platform/llm/types.js';
import { mapProviderType } from '@/platform/utils/llm-utils.js';
import { parseModelIdentifier } from '@/platform/utils/model-parser.js';

export const DEFAULT_FALLBACK_LLM_CONFIG: Readonly<LLMConfig> = {
    provider: LLMProviderType.OpenAIResponses,
    model: 'gpt-4o-mini',
};

export function resolveLLMConfig(modelIdentifier: string, config: FullConfig): LLMConfig {
    const { providerName, modelAlias } = parseModelIdentifier(modelIdentifier);

    const providerDetails = config.providers[providerName];
    if (!providerDetails) {
        throw new Error(`配置错误：未在 providers 中找到名为 '${providerName}' 的端点配置。`);
    }

    const modelConfig = providerDetails.models?.[modelAlias];
    if (!modelConfig) {
        throw new Error(
            `配置错误：在 provider '${providerName}' 中未找到名为 '${modelAlias}' 的模型配置。`,
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
