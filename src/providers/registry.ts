import { LLMProvider } from './base.js';
import { AnthropicMessagesAdapter } from './adapters/AnthropicMessagesAdapter.js';
import { OpenAIChatAdapter } from './adapters/OpenAIChatAdapter.js';
import { OpenAIResponsesAdapter } from './adapters/OpenAIResponsesAdapter.js';
import { RuntimeBackedProvider } from './core/provider.js';
import type { ProviderConfig } from '../types.js';
import { logger } from '../observability/index.js';

const log = logger.child('Provider');

type ProviderType = ProviderConfig['type'];

interface ProviderSpec {
  displayName: string;
  defaultApiBase: string;
  create(
    apiKey?: string,
    apiBase?: string,
    headers?: Record<string, string>,
    extraBody?: Record<string, any>
  ): LLMProvider;
}

const PROVIDER_SPECS: Record<ProviderType, ProviderSpec> = {
  anthropic: {
    displayName: 'Anthropic',
    defaultApiBase: 'https://api.anthropic.com/v1',
    create: (apiKey, apiBase, headers, extraBody) => new RuntimeBackedProvider(
      new AnthropicMessagesAdapter(),
      apiKey,
      apiBase,
      headers,
      extraBody
    )
  },
  openai: {
    displayName: 'OpenAI',
    defaultApiBase: 'https://api.openai.com/v1',
    create: (apiKey, apiBase, headers, extraBody) => new RuntimeBackedProvider(
      new OpenAIChatAdapter(),
      apiKey,
      apiBase,
      headers,
      extraBody
    )
  },
  openai_responses: {
    displayName: 'OpenAI Responses',
    defaultApiBase: 'https://api.openai.com/v1',
    create: (apiKey, apiBase, headers, extraBody) => new RuntimeBackedProvider(
      new OpenAIResponsesAdapter(),
      apiKey,
      apiBase,
      headers,
      extraBody
    )
  }
};

function getProviderSpec(type: ProviderType): ProviderSpec {
  const spec = PROVIDER_SPECS[type];
  if (spec) {
    return spec;
  }

  const available = Object.keys(PROVIDER_SPECS).join(', ');
  log.error(`未知提供商类型: ${type}。可用类型: ${available}`);
  throw new Error(`Unknown provider type: ${type}. Available: ${available}`);
}

function createProviderInstance(type: ProviderType, config: ProviderConfig, instanceName: string): LLMProvider {
  const spec = getProviderSpec(type);
  const apiKey = config.apiKey;
  const apiBase = config.apiBase || spec.defaultApiBase;
  const headers = config.headers;
  const extraBody = config.extraBody;

  log.info(`正在创建提供商: ${instanceName} (${spec.displayName})`, {
    providerName: instanceName,
    providerType: type
  });
  log.debug(`API Base: ${apiBase}`);
  log.debug(`API Key: ${apiKey ? apiKey.substring(0, 10) + '...' : '(empty)'}`);
  if (headers) {
    log.debug(`Custom headers: ${Object.keys(headers).join(', ')}`);
  }
  if (extraBody) {
    log.debug(`Extra body: ${Object.keys(extraBody).join(', ')}`);
  }

  return spec.create(apiKey, apiBase, headers, extraBody);
}

export function createProvider(name: string, config: ProviderConfig): LLMProvider {
  return createProviderInstance(config.type, config, name);
}
