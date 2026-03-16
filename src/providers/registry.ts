import { LLMProvider } from './base.js';
import { OpenAIProvider } from './OpenAIProvider.js';
import type { ProviderConfig } from '../types.js';
import { logger } from '../observability/index.js';

const log = logger.child('Provider');

const PROVIDER_TYPES = [
  { type: 'openai', displayName: 'OpenAI', defaultApiBase: 'https://api.openai.com/v1' }
] as const;

type ProviderType = typeof PROVIDER_TYPES[number]['type'];

function createProviderInstance(type: ProviderType, config: ProviderConfig, instanceName: string): LLMProvider {
  const spec = PROVIDER_TYPES.find((item) => item.type === type);
  if (!spec) {
    const available = PROVIDER_TYPES.map((item) => item.type).join(', ');
    log.error(`未知提供商类型: ${type}。可用类型: ${available}`);
    throw new Error(`Unknown provider type: ${type}. Available: ${available}`);
  }

  const apiKey = config.apiKey;
  const apiBase = config.apiBase || spec?.defaultApiBase || '';
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

  return new OpenAIProvider(apiKey, apiBase, headers, extraBody);
}

export function createProvider(name: string, config: ProviderConfig): LLMProvider {
  return createProviderInstance(config.type, config, name);
}
