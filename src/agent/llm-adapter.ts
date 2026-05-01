import { completeSimple, getModel, streamSimple } from '@mariozechner/pi-ai';
import type { Api, KnownProvider, Model } from '@mariozechner/pi-ai';
import type { ConfigManager } from '../core/config/config-manager';
import type { ProviderConfig } from '../core/config/schema';
import { createScopedLogger } from '../core/logger';
import { extractMessageText } from './agent-types';
import type { ResolvedModel, StreamFn, AgentMessage } from './agent-types';

export type ImageAnalysisInput = {
  data: string;
  mimeType: string;
}

export type AudioTranscriptionInput = {
  data: Uint8Array;
  mimeType: string;
  fileName: string;
}

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

const API_TYPE_MAP = {
  openai_responses: 'openai-responses',
  openai_completion: 'openai-completions',
  anthropic: 'anthropic-messages',
} as const satisfies Record<ProviderConfig['apiType'], Api>;

export type LlmAdapterDependencies = {
  configManager: ConfigManager;
}

export class LlmAdapter {
  private configManager: ConfigManager | null = null;
  private initialized = false;

  initialize(deps: LlmAdapterDependencies): void {
    if (this.initialized) {
      logger.warn('LlmAdapter 已初始化 — 跳过');
      return;
    }
    this.configManager = deps.configManager;
    this.initialized = true;
    logger.info('LlmAdapter 已初始化');
  }

  resolveModel(modelIdentifier: string): ResolvedModel {
    if (!this.configManager) {
      throw new Error('LlmAdapter 未初始化');
    }

    const slashIndex = modelIdentifier.indexOf('/');
    if (slashIndex === -1) {
      throw new Error(
        `模型标识符格式无效: "${modelIdentifier}"。应为 "provider/modelId"。`,
      );
    }

    const provider = modelIdentifier.substring(0, slashIndex);
    const modelId = modelIdentifier.substring(slashIndex + 1);
    const providers = this.configManager.get('providers');
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
    if (!this.configManager) {
      throw new Error('LlmAdapter 未初始化');
    }

    const configManager = this.configManager;

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
    const prompt = this.buildSummaryPrompt(messages);

    logger.debug('正在总结对话历史', {
      messageCount: messages.length,
      model: modelIdentifier,
      sessionId,
    });

    try {
      const response = await completeSimple(
        model,
        {
          systemPrompt:
            [
              'You are a conversation archivist. Summarize the following dialogue into a compact record for future turns.',
              'Output ONLY the summary in the following structure, using plain text:',
              '',
              '## Previous Discussion',
              '- What has already been discussed with the user (topics, decisions made, conclusions reached)',
              '',
              '## Current Focus',
              '- What is being worked on or discussed right now (the active task or question)',
              '',
              '## Next Steps',
              '- What remains to be done, unresolved questions, or pending follow-ups',
              '',
              '## Notes',
              '- Special constraints, important facts, user preferences, tool results, file paths, or any context critical for continuity',
              '',
              'Keep each section concise. Do not mention that you are summarizing or refer to missing context.',
            ].join('\n'),
          messages: [
            {
              role: 'user',
              content: prompt,
              timestamp: Date.now(),
            },
          ],
        },
        {
          apiKey: model.apiKey,
          sessionId,
          onPayload: makeExtraBodyOnPayload(model),
        },
      );

      const summary = extractMessageText(response).trim();

      if (summary.length === 0) {
        throw new Error('LLM 返回了空总结');
      }

      return summary;
    } catch (error: unknown) {
      logger.error('总结对话历史失败', error);
      throw error;
    }
  }

  async analyzeImage(
    modelIdentifier: string,
    question: string,
    image: ImageAnalysisInput,
    sessionId?: string,
  ): Promise<string> {
    const model = this.resolveModel(modelIdentifier);

    if (!model.input.includes('image')) {
      throw new Error(`配置的模型 "${modelIdentifier}" 不支持图像输入`);
    }

    const response = await completeSimple(
      model,
      {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: question },
              { type: 'image', data: image.data, mimeType: image.mimeType },
            ],
            timestamp: Date.now(),
          },
        ],
      },
      {
        apiKey: model.apiKey,
        sessionId,
        onPayload: makeExtraBodyOnPayload(model),
      },
    );

    const answer = extractMessageText(response).trim();
    if (answer.length === 0) {
      throw new Error('LLM 返回了空图像分析回复');
    }

    return answer;
  }

  async transcribeAudio(
    modelIdentifier: string,
    audio: AudioTranscriptionInput,
    sessionId?: string,
  ): Promise<string> {
    const model = this.resolveModel(modelIdentifier);

    if (model.apiType !== 'openai-responses' && model.apiType !== 'openai-completions') {
      throw new Error(`提供者 API 类型 "${model.apiType}" 不支持语音转文本`);
    }

    if (!model.apiKey) {
      throw new Error(`未为语音转文本提供者 "${model.provider}" 配置 API 密钥`);
    }

    const endpoint = new URL('audio/transcriptions', getProviderBaseUrl(model)).toString();
    const formData = new FormData();
    formData.append('model', model.id);
    formData.append(
      'file',
      new File([Buffer.from(audio.data)], audio.fileName, { type: audio.mimeType }),
    );

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${model.apiKey}`,
        ...(sessionId ? { 'x-session-id': sessionId } : {}),
      },
      body: formData,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `语音转文本请求失败 (${response.status}): ${body || response.statusText}`,
      );
    }

    const payload = (await response.json()) as { text?: unknown };
    const text = typeof payload.text === 'string' ? payload.text.trim() : '';

    if (text.length === 0) {
      throw new Error('语音转文本响应未包含转录文本');
    }

    return text;
  }

  private tryGetBuiltInModel(provider: string, modelId: string): Model<Api> | null {
    try {
      return getModel(provider as KnownProvider, modelId as never) as Model<Api>;
    } catch {
      return null;
    }
  }

  private buildSummaryPrompt(messages: AgentMessage[]): string {
    const transcript = messages
      .map((message) => `${message.role.toUpperCase()}: ${extractMessageText(message).trim()}`)
      .filter((line) => !line.endsWith(':'))
      .join('\n\n');

    return [
      'Conversation transcript:',
      '',
      transcript,
    ].join('\n');
  }
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

function getProviderBaseUrl(model: ResolvedModel): string {
  if (model.baseUrl.trim().length > 0) {
    return ensureTrailingSlash(model.baseUrl);
  }

  if (model.provider === 'openai') {
    return 'https://api.openai.com/v1/';
  }

  throw new Error(`未为提供者 "${model.provider}" 配置 base URL`);
}
