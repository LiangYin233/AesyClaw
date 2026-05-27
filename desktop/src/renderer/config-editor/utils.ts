import type {
  ApiType,
  ConfigSectionKey,
  JsonParseResult,
  McpServerForm,
  McpTransport,
  ProviderForm,
  ProviderModelForm,
} from './types';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function renameProviderScopedState(
  source: Record<string, string>,
  oldProviderKey: string,
  newProviderKey: string,
): Record<string, string> {
  const prefix = `${oldProviderKey}:`;
  return Object.fromEntries(
    Object.entries(source).map(([key, value]) => [
      key.startsWith(prefix) ? `${newProviderKey}:${key.slice(prefix.length)}` : key,
      value,
    ]),
  );
}

export function getRawModels(provider: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(provider['models'])) return {};
  return Object.fromEntries(
    Object.entries(provider['models']).map(([key, model]) => [
      key,
      isRecord(model) ? { ...model } : {},
    ]),
  );
}

export function updateOptionalProperty(
  source: Record<string, unknown>,
  key: string,
  value: string,
): Record<string, unknown> {
  return setOptionalProperty(source, key, value, value.trim().length > 0);
}

export function setOptionalProperty(
  source: Record<string, unknown>,
  key: string,
  value: unknown,
  shouldSet: boolean,
): Record<string, unknown> {
  const next = { ...source };
  if (shouldSet) next[key] = value;
  else delete next[key];
  return next;
}

export function updateExtraBody(
  model: Record<string, unknown>,
  value: unknown,
): Record<string, unknown> {
  const next = { ...model };
  if (isRecord(value) && Object.keys(value).length > 0) next['extraBody'] = value;
  else delete next['extraBody'];
  return next;
}

export function parseEnvText(value: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of value.split('\n')) {
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    if (key.length === 0) continue;
    env[key] = line.slice(separatorIndex + 1);
  }
  return env;
}

export function nextUniqueKey(source: Record<string, unknown>, baseKey: string): string {
  let nextKey = baseKey;
  let suffix = 1;
  while (Object.hasOwn(source, nextKey)) {
    suffix += 1;
    nextKey = `${baseKey}-${suffix}`;
  }
  return nextKey;
}

export function renameRecordKey(
  source: Record<string, unknown>,
  oldKey: string,
  newKey: string,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(source).map(([key, value]) => [key === oldKey ? newKey : key, value]),
  );
}

export function normalizeProvider(key: string, value: unknown): ProviderForm {
  const source = isRecord(value) ? value : {};
  return {
    ...source,
    key,
    apiType: isApiType(source['apiType']) ? source['apiType'] : 'openai-responses',
    baseUrl: typeof source['baseUrl'] === 'string' ? source['baseUrl'] : undefined,
    apiKey: typeof source['apiKey'] === 'string' ? source['apiKey'] : undefined,
    models: normalizeProviderModels(source['models']),
  };
}

export function normalizeProviderModels(value: unknown): ProviderModelForm[] {
  if (!isRecord(value)) return [];
  return Object.entries(value).map(([key, model]) => {
    const source = isRecord(model) ? model : {};
    return {
      ...source,
      key,
      contextWindow:
        typeof source['contextWindow'] === 'number' ? source['contextWindow'] : undefined,
      extraBody: isRecord(source['extraBody']) ? source['extraBody'] : undefined,
    };
  });
}

export function normalizeMcpServer(value: unknown): McpServerForm {
  const source = isRecord(value) ? value : {};
  return {
    ...source,
    name: typeof source['name'] === 'string' ? source['name'] : '',
    transport: isMcpTransport(source['transport']) ? source['transport'] : 'stdio',
    enabled: typeof source['enabled'] === 'boolean' ? source['enabled'] : true,
    command: typeof source['command'] === 'string' ? source['command'] : undefined,
    args: Array.isArray(source['args'])
      ? source['args'].filter((item): item is string => typeof item === 'string')
      : undefined,
    env: isStringRecord(source['env']) ? source['env'] : undefined,
    url: typeof source['url'] === 'string' ? source['url'] : undefined,
  };
}

export function isMcpTransport(value: unknown): value is McpTransport {
  return value === 'stdio' || value === 'sse' || value === 'http';
}

export function isApiType(value: unknown): value is ApiType {
  return (
    value === 'openai-responses' || value === 'openai-completions' || value === 'anthropic-messages'
  );
}

export function parseJson(value: string): JsonParseResult {
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Invalid JSON' };
  }
}

export function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === 'string');
}

export function getExtraBodyErrorKey(providerKey: string, modelKey: string): string {
  return `${providerKey}:${modelKey}`;
}

export function getSectionValue(source: unknown, key: ConfigSectionKey): unknown {
  if (!isRecord(source)) return getDefaultSectionValue(key);
  const value = source[key];
  if (value === undefined) return getDefaultSectionValue(key);
  if (key === 'mcp') return Array.isArray(value) ? value : [];
  if (key === 'channels' || key === 'plugins') return isRecord(value) ? value : {};
  return value;
}

export function getDefaultSectionValue(key: ConfigSectionKey): unknown {
  if (key === 'mcp') return [];
  return {};
}


export function formatFieldLabel(key: string): string {
  return key
    .split('.')
    .map((part) =>
      part
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase()),
    )
    .join(' > ');
}
