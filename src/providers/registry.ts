import { LLMProvider } from './base.js';
import { OpenAIProvider } from './OpenAIProvider.js';
import type { ProviderConfig } from '../types.js';
import { logger } from '../logger/index.js';

const log = logger.child({ prefix: 'Provider' });

const BUILTIN_PROVIDERS = [
  { name: 'openai', displayName: 'OpenAI', defaultApiBase: 'https://api.openai.com/v1' },
  { name: 'custom', displayName: 'Custom (OpenAI Compatible)', defaultApiBase: '' },
];

export function createProvider(name: string, config: ProviderConfig): LLMProvider {
  const spec = BUILTIN_PROVIDERS.find(p => p.name === name);

  if (!spec) {
    if (!config.apiBase) {
      const available = BUILTIN_PROVIDERS.map(p => p.name).join(', ');
      log.error(`Unknown provider: ${name}. Available: ${available}`);
      throw new Error(`Unknown provider: ${name}. Available: ${available}`);
    }
    log.info(`Using custom provider: ${name} with apiBase: ${config.apiBase}`);
  }

  const apiKey = config.apiKey;
  const apiBase = config.apiBase || spec?.defaultApiBase || '';
  const headers = config.headers;
  const extraBody = config.extraBody;

  const displayName = spec?.displayName || name;
  log.info(`Creating provider: ${name} (${displayName})`);
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
