import { LLMProvider } from './base.js';
import { OpenAIProvider } from './OpenAIProvider.js';
import type { ProviderConfig } from '../types.js';
import { logger } from '../logger/index.js';

export interface ProviderSpec {
  name: string;
  displayName: string;
  defaultApiBase: string;
}

const PROVIDERS: ProviderSpec[] = [
  { name: 'openai', displayName: 'OpenAI', defaultApiBase: 'https://api.openai.com/v1' },
  { name: 'custom', displayName: 'Custom (OpenAI Compatible)', defaultApiBase: '' },
];

export function createProvider(name: string, config: ProviderConfig): LLMProvider {
  const spec = PROVIDERS.find(p => p.name === name);
  
  if (!spec) {
    const available = PROVIDERS.map(p => p.name).join(', ');
    logger.error(`Unknown provider: ${name}. Available: ${available}`);
    throw new Error(`Unknown provider: ${name}. Available: ${available}`);
  }

  const apiKey = config.apiKey;
  const apiBase = config.apiBase || spec.defaultApiBase;
  const headers = config.headers;
  const extraBody = config.extraBody;

  logger.info(`Creating provider: ${name} (${spec.displayName})`);
  logger.debug(`API Base: ${apiBase}`);
  logger.debug(`API Key: ${apiKey ? apiKey.substring(0, 10) + '...' : '(empty)'}`);
  if (headers) {
    logger.debug(`Custom headers: ${Object.keys(headers).join(', ')}`);
  }
  if (extraBody) {
    logger.debug(`Extra body: ${Object.keys(extraBody).join(', ')}`);
  }

  return new OpenAIProvider(apiKey, apiBase, headers, extraBody);
}

export { PROVIDERS as providerSpecs };
