/** @file pi-ai Model 构建器
 *
 * 根据 AesyClaw 的 LLMConfig 和 ProvidersConfig 构建 pi-ai 的 Model 对象。
 */

import type { Model, Api, Provider } from '@mariozechner/pi-ai';
import type { ProvidersConfig } from '@/features/config/schema.js';
import { type LLMConfig } from '@/platform/llm/types.js';

/** 根据 LLM 配置构建 pi-ai Model 对象 */
export function buildModel(llmConfig: LLMConfig, providers?: ProvidersConfig): Model<Api> {
    const apiMap: Record<string, Api> = {
        'openai-responses': 'openai-responses',
        'openai-completion': 'openai-completions',
        anthropic: 'anthropic-messages',
    };

    const providerMap: Record<string, Provider> = {
        'openai-responses': 'openai',
        'openai-completion': 'openai',
        anthropic: 'anthropic',
    };

    const api = apiMap[llmConfig.provider] || ('openai-responses' as Api);
    const provider = providerMap[llmConfig.provider] || ('openai' as Provider);
    const modelId = llmConfig.model || 'gpt-4o-mini';

    let contextWindow = 128000;
    let maxTokens = 16384;
    let reasoning = false;

    if (providers) {
        for (const providerConfig of Object.values(providers)) {
            if (!providerConfig.models) {
                continue;
            }
            for (const modelConfig of Object.values(providerConfig.models)) {
                if (modelConfig.modelname === modelId) {
                    contextWindow = modelConfig.contextWindow;
                    reasoning = modelConfig.reasoning;
                    maxTokens = Math.min(16384, contextWindow);
                    break;
                }
            }
        }
    }

    return {
        id: modelId,
        name: modelId,
        api,
        provider,
        baseUrl: llmConfig.baseUrl || '',
        reasoning,
        input: ['text'] as ('text' | 'image')[],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow,
        maxTokens,
    } as Model<Api>;
}
