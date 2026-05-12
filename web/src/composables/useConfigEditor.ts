/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import { computed, onMounted, ref } from 'vue';
import { useWebSocket } from '@/composables/useWebSocket';
import { useToast } from '@/composables/useToast';
import { isRecord, toJson } from '@/lib/object';

type McpTransport = 'stdio' | 'sse' | 'http';
type ApiType = 'openai-responses' | 'openai-completions' | 'anthropic-messages';
type JsonParseResult = { ok: true; value: unknown } | { ok: false; error: string };

interface JsonSchemaRecord extends Record<string, unknown> {
  properties?: Record<string, unknown>;
}

interface ConfigSectionView {
  key: string;
  title: string;
  subtitle: string;
  schema: Record<string, unknown>;
}

interface McpServerForm extends Record<string, unknown> {
  name: string;
  transport: McpTransport;
  enabled: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

interface ProviderModelForm extends Record<string, unknown> {
  key: string;
  contextWindow?: number;
  extraBody?: Record<string, unknown>;
}

interface ProviderForm extends Record<string, unknown> {
  key: string;
  apiType: ApiType;
  baseUrl?: string;
  apiKey?: string;
  models: ProviderModelForm[];
}

export function useConfigEditor() {
  const ws = useWebSocket();
  const { showToast } = useToast();

  const editableSchema = ref<Record<string, unknown>>({});
  const editableConfig = ref<Record<string, unknown>>({});
  const loading = ref(true);
  const saving = ref(false);
  const error = ref('');
  const extraBodyErrors = ref<Record<string, string>>({});
  const extraBodyDrafts = ref<Record<string, string>>({});

  const excludedTopLevelKeys = new Set(['channels', 'plugins']);
  const hiddenSchemaKeys = new Set(['channels', 'plugins', 'providers', 'mcp']);

  const configSections = computed<ConfigSectionView[]>(() => {
    const properties = getSchemaProperties(editableSchema.value);
    return Object.entries(properties).map(([key, schema]) => ({
      key,
      title: formatSectionTitle(key),
      subtitle: getSectionSubtitle(key),
      schema: isRecord(schema) ? schema : {},
    }));
  });

  const mcpServers = computed<McpServerForm[]>(() => {
    const value = editableConfig.value['mcp'];
    return Array.isArray(value) ? value.map(normalizeMcpServer) : [];
  });

  const providerEntries = computed<ProviderForm[]>(() => {
    const value = editableConfig.value['providers'];
    return isRecord(value)
      ? Object.entries(value).map(([key, provider]) => normalizeProvider(key, provider))
      : [];
  });

  const hasExtraBodyErrors = computed(() => Object.keys(extraBodyErrors.value).length > 0);

  async function loadSchema(): Promise<void> {
    try {
      const schema = (await ws.send('get_config_schema')) as Record<string, unknown>;
      editableSchema.value = omitTopLevelSchemaProperties(schema, hiddenSchemaKeys);
    } catch (err) {
      console.error('Failed to load schema', err);
    }
  }

  async function loadConfig(): Promise<void> {
    loading.value = true;
    error.value = '';
    try {
      const config = (await ws.send('get_config')) as Record<string, unknown>;
      editableConfig.value = omitTopLevelConfigKeys(config, excludedTopLevelKeys);
      extraBodyErrors.value = {};
      extraBodyDrafts.value = {};
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load config';
    } finally {
      loading.value = false;
    }
  }

  async function saveConfig(): Promise<void> {
    if (hasExtraBodyErrors.value) {
      showToast('toast-error', 'Fix invalid extra body JSON before saving');
      return;
    }
    saving.value = true;
    try {
      await ws.send('update_config', editableConfig.value);
      showToast('toast-success', 'Configuration saved successfully');
    } catch (err) {
      showToast('toast-error', err instanceof Error ? err.message : 'Save failed');
    } finally {
      saving.value = false;
    }
  }

  function updateConfigSection(key: string, value: unknown): void {
    editableConfig.value = { ...editableConfig.value, [key]: value };
  }

  function addProvider(): void {
    const providers = getRawProviders();
    const nextKey = nextUniqueKey(providers, 'new-provider');
    editableConfig.value = {
      ...editableConfig.value,
      providers: { ...providers, [nextKey]: { apiType: 'openai-responses', models: {} } },
    };
  }

  function removeProvider(key: string): void {
    const providers = getRawProviders();
    delete providers[key];
    clearProviderExtraBodyErrors(key);
    editableConfig.value = { ...editableConfig.value, providers };
  }

  function renameProvider(oldKey: string, newKeyRaw: string): void {
    const newKey = newKeyRaw.trim();
    const providers = getRawProviders();
    if (newKey.length === 0 || newKey === oldKey) return;
    if (Object.hasOwn(providers, newKey)) {
      showToast('toast-error', `A provider named "${newKey}" already exists`);
      return;
    }
    const next = renameRecordKey(providers, oldKey, newKey);
    renameProviderExtraBodyState(oldKey, newKey);
    editableConfig.value = { ...editableConfig.value, providers: next };
  }

  function updateProviderField(providerKey: string, key: 'apiType', value: unknown): void {
    updateProvider(providerKey, (provider) => ({
      ...provider,
      [key]: isApiType(value) ? value : 'openai-responses',
    }));
  }

  function updateProviderOptionalString(
    providerKey: string,
    key: 'apiKey' | 'baseUrl',
    value: string,
  ): void {
    updateProvider(providerKey, (provider) => updateOptionalProperty(provider, key, value));
  }

  function addProviderModel(providerKey: string): void {
    updateProvider(providerKey, (provider) => {
      const models = getRawModels(provider);
      const nextKey = nextUniqueKey(models, 'new-model');
      return { ...provider, models: { ...models, [nextKey]: {} } };
    });
  }

  function removeProviderModel(providerKey: string, modelKey: string): void {
    updateProvider(providerKey, (provider) => {
      const models = getRawModels(provider);
      delete models[modelKey];
      clearExtraBodyState(providerKey, modelKey);
      return { ...provider, models };
    });
  }

  function renameProviderModel(providerKey: string, oldKey: string, newKeyRaw: string): void {
    const newKey = newKeyRaw.trim();
    if (newKey.length === 0 || newKey === oldKey) return;
    updateProvider(providerKey, (provider) => {
      const models = getRawModels(provider);
      if (Object.hasOwn(models, newKey)) {
        showToast('toast-error', `A model preset named "${newKey}" already exists`);
        return provider;
      }
      renameExtraBodyState(providerKey, oldKey, newKey);
      return { ...provider, models: renameRecordKey(models, oldKey, newKey) };
    });
  }

  function updateProviderModelNumber(providerKey: string, modelKey: string, value: string): void {
    updateProviderModel(providerKey, modelKey, (model) => {
      const next = { ...model };
      const parsed = Number(value);
      if (value.trim().length > 0 && Number.isFinite(parsed)) {
        next['contextWindow'] = parsed;
      } else {
        delete next['contextWindow'];
      }
      return next;
    });
  }

  function updateProviderModelExtraBody(
    providerKey: string,
    modelKey: string,
    value: string,
  ): void {
    setExtraBodyDraft(providerKey, modelKey, value);
    const result = parseJson(value);
    if (!result.ok) {
      setExtraBodyError(providerKey, modelKey, result.error);
      return;
    }
    clearExtraBodyError(providerKey, modelKey);
    updateProviderModel(providerKey, modelKey, (model) => updateExtraBody(model, result.value));
  }

  function addMcpServer(): void {
    const next = [...getRawMcpServers(), { name: '', transport: 'stdio', enabled: true }];
    editableConfig.value = { ...editableConfig.value, mcp: next };
  }

  function removeMcpServer(index: number): void {
    updateMcpServers((servers) => servers.filter((_, itemIndex) => itemIndex !== index));
  }

  function updateMcpField(index: number, key: keyof McpServerForm, value: unknown): void {
    updateMcpServer(index, (server) => ({ ...server, [key]: value }));
  }

  function updateOptionalStringField(index: number, key: 'command' | 'url', value: string): void {
    updateMcpServer(index, (server) => updateOptionalProperty(server, key, value));
  }

  function updateArgs(index: number, value: string): void {
    const args = value
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    updateMcpServer(index, (server) => setOptionalProperty(server, 'args', args, args.length > 0));
  }

  function updateEnv(index: number, value: string): void {
    const env = parseEnvText(value);
    updateMcpServer(index, (server) =>
      setOptionalProperty(server, 'env', env, Object.keys(env).length > 0),
    );
  }

  function argsToText(value: unknown): string {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string').join('\n')
      : '';
  }

  function envToText(value: unknown): string {
    if (!isStringRecord(value)) return '';
    return Object.entries(value)
      .map(([key, envValue]) => `${key}=${envValue}`)
      .join('\n');
  }

  function getExtraBodyError(providerKey: string, modelKey: string): string {
    return extraBodyErrors.value[getExtraBodyErrorKey(providerKey, modelKey)] ?? '';
  }

  function getExtraBodyText(providerKey: string, modelKey: string, value: unknown): string {
    const key = getExtraBodyErrorKey(providerKey, modelKey);
    return extraBodyDrafts.value[key] ?? toJson(value);
  }

  onMounted(() => {
    void loadSchema();
    void loadConfig();
  });

  return {
    editableConfig,
    loading,
    saving,
    error,
    configSections,
    mcpServers,
    providerEntries,
    hasExtraBodyErrors,
    loadConfig,
    saveConfig,
    updateConfigSection,
    addProvider,
    removeProvider,
    renameProvider,
    updateProviderField,
    updateProviderOptionalString,
    addProviderModel,
    removeProviderModel,
    renameProviderModel,
    updateProviderModelNumber,
    updateProviderModelExtraBody,
    addMcpServer,
    removeMcpServer,
    updateMcpField,
    updateOptionalStringField,
    updateArgs,
    updateEnv,
    argsToText,
    envToText,
    getExtraBodyError,
    getExtraBodyText,
  };

  function setExtraBodyDraft(providerKey: string, modelKey: string, value: string): void {
    extraBodyDrafts.value = {
      ...extraBodyDrafts.value,
      [getExtraBodyErrorKey(providerKey, modelKey)]: value,
    };
  }

  function setExtraBodyError(providerKey: string, modelKey: string, message: string): void {
    extraBodyErrors.value = {
      ...extraBodyErrors.value,
      [getExtraBodyErrorKey(providerKey, modelKey)]: message,
    };
  }

  function clearExtraBodyError(providerKey: string, modelKey: string): void {
    const key = getExtraBodyErrorKey(providerKey, modelKey);
    if (!Object.hasOwn(extraBodyErrors.value, key)) return;
    const next = { ...extraBodyErrors.value };
    delete next[key];
    extraBodyErrors.value = next;
  }

  function clearExtraBodyDraft(providerKey: string, modelKey: string): void {
    const key = getExtraBodyErrorKey(providerKey, modelKey);
    if (!Object.hasOwn(extraBodyDrafts.value, key)) return;
    const next = { ...extraBodyDrafts.value };
    delete next[key];
    extraBodyDrafts.value = next;
  }

  function clearExtraBodyState(providerKey: string, modelKey: string): void {
    clearExtraBodyError(providerKey, modelKey);
    clearExtraBodyDraft(providerKey, modelKey);
  }

  function clearProviderExtraBodyErrors(providerKey: string): void {
    const prefix = `${providerKey}:`;
    extraBodyErrors.value = Object.fromEntries(
      Object.entries(extraBodyErrors.value).filter(([key]) => !key.startsWith(prefix)),
    );
    extraBodyDrafts.value = Object.fromEntries(
      Object.entries(extraBodyDrafts.value).filter(([key]) => !key.startsWith(prefix)),
    );
  }

  function renameExtraBodyState(
    providerKey: string,
    oldModelKey: string,
    newModelKey: string,
  ): void {
    const oldKey = getExtraBodyErrorKey(providerKey, oldModelKey);
    const newKey = getExtraBodyErrorKey(providerKey, newModelKey);
    if (extraBodyErrors.value[oldKey]) {
      extraBodyErrors.value = { ...extraBodyErrors.value, [newKey]: extraBodyErrors.value[oldKey] };
      clearExtraBodyError(providerKey, oldModelKey);
    }
    if (extraBodyDrafts.value[oldKey]) {
      extraBodyDrafts.value = { ...extraBodyDrafts.value, [newKey]: extraBodyDrafts.value[oldKey] };
      clearExtraBodyDraft(providerKey, oldModelKey);
    }
  }

  function renameProviderExtraBodyState(oldProviderKey: string, newProviderKey: string): void {
    extraBodyErrors.value = renameProviderScopedState(
      extraBodyErrors.value,
      oldProviderKey,
      newProviderKey,
    );
    extraBodyDrafts.value = renameProviderScopedState(
      extraBodyDrafts.value,
      oldProviderKey,
      newProviderKey,
    );
  }

  function updateProvider(
    providerKey: string,
    updater: (provider: Record<string, unknown>) => Record<string, unknown>,
  ): void {
    const providers = getRawProviders();
    const current = providers[providerKey];
    if (!isRecord(current)) return;
    providers[providerKey] = updater(current);
    editableConfig.value = { ...editableConfig.value, providers };
  }

  function updateProviderModel(
    providerKey: string,
    modelKey: string,
    updater: (model: Record<string, unknown>) => Record<string, unknown>,
  ): void {
    updateProvider(providerKey, (provider) => {
      const models = getRawModels(provider);
      const current = models[modelKey];
      if (!isRecord(current)) return provider;
      models[modelKey] = updater(current);
      return { ...provider, models };
    });
  }

  function updateMcpServer(
    index: number,
    updater: (server: Record<string, unknown>) => Record<string, unknown>,
  ): void {
    updateMcpServers((servers) => {
      const current = servers[index];
      if (current === undefined) return servers;
      return servers.map((server, itemIndex) => (itemIndex === index ? updater(server) : server));
    });
  }

  function updateMcpServers(
    updater: (servers: Record<string, unknown>[]) => Record<string, unknown>[],
  ): void {
    editableConfig.value = { ...editableConfig.value, mcp: updater(getRawMcpServers()) };
  }

  function getRawProviders(): Record<string, unknown> {
    const value = editableConfig.value['providers'];
    if (!isRecord(value)) return {};
    return Object.fromEntries(
      Object.entries(value).map(([key, provider]) => [
        key,
        isRecord(provider) ? { ...provider } : {},
      ]),
    );
  }

  function getRawMcpServers(): Record<string, unknown>[] {
    const value = editableConfig.value['mcp'];
    return Array.isArray(value) ? value.map((item) => (isRecord(item) ? { ...item } : {})) : [];
  }
}

function renameProviderScopedState(
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

function getRawModels(provider: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(provider['models'])) return {};
  return Object.fromEntries(
    Object.entries(provider['models']).map(([key, model]) => [
      key,
      isRecord(model) ? { ...model } : {},
    ]),
  );
}

function updateOptionalProperty(
  source: Record<string, unknown>,
  key: string,
  value: string,
): Record<string, unknown> {
  return setOptionalProperty(source, key, value, value.trim().length > 0);
}

function setOptionalProperty(
  source: Record<string, unknown>,
  key: string,
  value: unknown,
  shouldSet: boolean,
): Record<string, unknown> {
  const next = { ...source };
  if (shouldSet) {
    next[key] = value;
  } else {
    delete next[key];
  }
  return next;
}

function updateExtraBody(model: Record<string, unknown>, value: unknown): Record<string, unknown> {
  const next = { ...model };
  if (isRecord(value) && Object.keys(value).length > 0) {
    next['extraBody'] = value;
  } else {
    delete next['extraBody'];
  }
  return next;
}

function parseEnvText(value: string): Record<string, string> {
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

function nextUniqueKey(source: Record<string, unknown>, baseKey: string): string {
  let nextKey = baseKey;
  let suffix = 1;
  while (Object.hasOwn(source, nextKey)) {
    suffix += 1;
    nextKey = `${baseKey}-${suffix}`;
  }
  return nextKey;
}

function renameRecordKey(
  source: Record<string, unknown>,
  oldKey: string,
  newKey: string,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(source).map(([key, value]) => [key === oldKey ? newKey : key, value]),
  );
}

function normalizeMcpServer(value: unknown): McpServerForm {
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

function normalizeProvider(key: string, value: unknown): ProviderForm {
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

function normalizeProviderModels(value: unknown): ProviderModelForm[] {
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

function isMcpTransport(value: unknown): value is McpTransport {
  return value === 'stdio' || value === 'sse' || value === 'http';
}

function isApiType(value: unknown): value is ApiType {
  return (
    value === 'openai-responses' || value === 'openai-completions' || value === 'anthropic-messages'
  );
}

function parseJson(value: string): JsonParseResult {
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid JSON';
    return { ok: false, error: message };
  }
}

function omitTopLevelConfigKeys(
  source: unknown,
  topLevelKeysToOmit: ReadonlySet<string>,
): Record<string, unknown> {
  if (!isRecord(source)) return {};
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (topLevelKeysToOmit.has(key.toLowerCase())) continue;
    next[key] = value;
  }
  return next;
}

function omitTopLevelSchemaProperties(
  source: unknown,
  keysToOmit: ReadonlySet<string>,
): Record<string, unknown> {
  if (!isRecord(source)) return {};
  const next: Record<string, unknown> = { ...source };
  if (isRecord(source['properties'])) {
    next['properties'] = filterSchemaProperties(source['properties'], keysToOmit);
  }
  if (Array.isArray(source['required'])) {
    next['required'] = source['required'].filter(
      (item): item is string => typeof item === 'string' && !keysToOmit.has(item.toLowerCase()),
    );
  }
  return next;
}

function filterSchemaProperties(
  properties: Record<string, unknown>,
  keysToOmit: ReadonlySet<string>,
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (!keysToOmit.has(key.toLowerCase())) next[key] = value;
  }
  return next;
}

function getSchemaProperties(schema: JsonSchemaRecord): Record<string, unknown> {
  return isRecord(schema['properties']) ? schema['properties'] : {};
}

function formatSectionTitle(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^\w/, (char) => char.toUpperCase());
}

function getSectionSubtitle(key: string): string {
  const subtitles: Record<string, string> = {
    server: 'Host, port, logging, and WebUI authentication settings.',
    providers: 'Provider credentials, protocol choices, and model presets.',
    agent: 'Agent memory and multimodal model defaults.',
  };
  return (
    subtitles[key] ??
    'Edit this config section while preserving unknown fields from the config API.'
  );
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === 'string');
}

function getExtraBodyErrorKey(providerKey: string, modelKey: string): string {
  return `${providerKey}:${modelKey}`;
}
