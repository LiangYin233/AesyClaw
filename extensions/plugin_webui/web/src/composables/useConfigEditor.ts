/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import { computed, onMounted, ref } from 'vue';
import { useWebSocket } from '@/composables/useWebSocket';
import { useToast } from '@/composables/useToast';
import { isRecord, toJson } from '@/lib/object';

import type { ConfigSectionView, McpServerForm, ProviderForm } from '@/config-editor/types';
import * as configEditor from '@/config-editor/utils';

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
    const properties = configEditor.getSchemaProperties(editableSchema.value);
    return Object.entries(properties).map(([key, schema]) => ({
      key,
      title: configEditor.formatSectionTitle(key),
      subtitle: configEditor.getSectionSubtitle(key),
      schema: isRecord(schema) ? schema : {},
    }));
  });

  const mcpServers = computed<McpServerForm[]>(() => {
    const value = editableConfig.value['mcp'];
    return Array.isArray(value) ? value.map(configEditor.normalizeMcpServer) : [];
  });

  const providerEntries = computed<ProviderForm[]>(() => {
    const value = editableConfig.value['providers'];
    return isRecord(value)
      ? Object.entries(value).map(([key, provider]) =>
          configEditor.normalizeProvider(key, provider),
        )
      : [];
  });

  const modelOptions = computed<Array<{ value: string; label: string }>>(() => {
    const providers = editableConfig.value['providers'];
    const opts: Array<{ value: string; label: string }> = [];
    if (isRecord(providers)) {
      for (const [providerName, providerCfg] of Object.entries(providers)) {
        if (isRecord(providerCfg)) {
          const models = (providerCfg as Record<string, unknown>)['models'];
          if (isRecord(models)) {
            for (const modelId of Object.keys(models)) {
              opts.push({
                value: `${providerName}/${modelId}`,
                label: `${providerName} / ${modelId}`,
              });
            }
          }
        }
      }
    }
    return opts;
  });

  async function loadSchema(): Promise<void> {
    try {
      const schema = (await ws.send('get_config_schema')) as Record<string, unknown>;
      editableSchema.value = configEditor.omitTopLevelSchemaProperties(schema, hiddenSchemaKeys);
    } catch (err) {
      console.error('Failed to load schema', err);
    }
  }

  async function loadConfig(): Promise<void> {
    loading.value = true;
    error.value = '';
    try {
      const config = (await ws.send('get_config')) as Record<string, unknown>;
      editableConfig.value = configEditor.omitTopLevelConfigKeys(config, excludedTopLevelKeys);
      extraBodyErrors.value = {};
      extraBodyDrafts.value = {};
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load config';
    } finally {
      loading.value = false;
    }
  }

  async function saveConfig(): Promise<void> {
    if (Object.keys(extraBodyErrors.value).length > 0) {
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
    const nextKey = configEditor.nextUniqueKey(providers, 'new-provider');
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
    const next = configEditor.renameRecordKey(providers, oldKey, newKey);
    renameProviderExtraBodyState(oldKey, newKey);
    editableConfig.value = { ...editableConfig.value, providers: next };
  }

  function updateProviderField(providerKey: string, key: 'apiType', value: unknown): void {
    updateProvider(providerKey, (provider) => ({
      ...provider,
      [key]: configEditor.isApiType(value) ? value : 'openai-responses',
    }));
  }

  function updateProviderOptionalString(
    providerKey: string,
    key: 'apiKey' | 'baseUrl',
    value: string,
  ): void {
    updateProvider(providerKey, (provider) =>
      configEditor.updateOptionalProperty(provider, key, value),
    );
  }

  function addProviderModel(providerKey: string): void {
    updateProvider(providerKey, (provider) => {
      const models = configEditor.getRawModels(provider);
      const nextKey = configEditor.nextUniqueKey(models, 'new-model');
      return { ...provider, models: { ...models, [nextKey]: {} } };
    });
  }

  function removeProviderModel(providerKey: string, modelKey: string): void {
    updateProvider(providerKey, (provider) => {
      const models = configEditor.getRawModels(provider);
      delete models[modelKey];
      clearExtraBodyState(providerKey, modelKey);
      return { ...provider, models };
    });
  }

  function renameProviderModel(providerKey: string, oldKey: string, newKeyRaw: string): void {
    const newKey = newKeyRaw.trim();
    if (newKey.length === 0 || newKey === oldKey) return;
    updateProvider(providerKey, (provider) => {
      const models = configEditor.getRawModels(provider);
      if (Object.hasOwn(models, newKey)) {
        showToast('toast-error', `A model preset named "${newKey}" already exists`);
        return provider;
      }
      renameExtraBodyState(providerKey, oldKey, newKey);
      return { ...provider, models: configEditor.renameRecordKey(models, oldKey, newKey) };
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
    const result = configEditor.parseJson(value);
    if (!result.ok) {
      setExtraBodyError(providerKey, modelKey, result.error);
      return;
    }
    clearExtraBodyError(providerKey, modelKey);
    updateProviderModel(providerKey, modelKey, (model) =>
      configEditor.updateExtraBody(model, result.value),
    );
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
    updateMcpServer(index, (server) => configEditor.updateOptionalProperty(server, key, value));
  }

  function updateArgs(index: number, value: string): void {
    const args = value
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    updateMcpServer(index, (server) =>
      configEditor.setOptionalProperty(server, 'args', args, args.length > 0),
    );
  }

  function updateEnv(index: number, value: string): void {
    const env = configEditor.parseEnvText(value);
    updateMcpServer(index, (server) =>
      configEditor.setOptionalProperty(server, 'env', env, Object.keys(env).length > 0),
    );
  }

  function argsToText(value: unknown): string {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string').join('\n')
      : '';
  }

  function envToText(value: unknown): string {
    if (!configEditor.isStringRecord(value)) return '';
    return Object.entries(value)
      .map(([key, envValue]) => `${key}=${envValue}`)
      .join('\n');
  }

  function getExtraBodyError(providerKey: string, modelKey: string): string {
    return extraBodyErrors.value[configEditor.getExtraBodyErrorKey(providerKey, modelKey)] ?? '';
  }

  function getExtraBodyText(providerKey: string, modelKey: string, value: unknown): string {
    const key = configEditor.getExtraBodyErrorKey(providerKey, modelKey);
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
    modelOptions,
    configSections,
    mcpServers,
    providerEntries,
    extraBodyErrors,
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
    extraBodyDrafts.value[configEditor.getExtraBodyErrorKey(providerKey, modelKey)] = value;
  }

  function setExtraBodyError(providerKey: string, modelKey: string, message: string): void {
    extraBodyErrors.value[configEditor.getExtraBodyErrorKey(providerKey, modelKey)] = message;
  }

  function clearExtraBodyError(providerKey: string, modelKey: string): void {
    const key = configEditor.getExtraBodyErrorKey(providerKey, modelKey);
    if (Object.hasOwn(extraBodyErrors.value, key)) {
      delete extraBodyErrors.value[key];
    }
  }

  function clearExtraBodyDraft(providerKey: string, modelKey: string): void {
    const key = configEditor.getExtraBodyErrorKey(providerKey, modelKey);
    if (Object.hasOwn(extraBodyDrafts.value, key)) {
      delete extraBodyDrafts.value[key];
    }
  }

  function clearExtraBodyState(providerKey: string, modelKey: string): void {
    clearExtraBodyError(providerKey, modelKey);
    clearExtraBodyDraft(providerKey, modelKey);
  }

  function clearProviderExtraBodyErrors(providerKey: string): void {
    const prefix = `${providerKey}:`;
    for (const key of Object.keys(extraBodyErrors.value)) {
      if (key.startsWith(prefix)) delete extraBodyErrors.value[key];
    }
    for (const key of Object.keys(extraBodyDrafts.value)) {
      if (key.startsWith(prefix)) delete extraBodyDrafts.value[key];
    }
  }

  function renameExtraBodyState(
    providerKey: string,
    oldModelKey: string,
    newModelKey: string,
  ): void {
    const oldKey = configEditor.getExtraBodyErrorKey(providerKey, oldModelKey);
    const newKey = configEditor.getExtraBodyErrorKey(providerKey, newModelKey);
    if (extraBodyErrors.value[oldKey] !== undefined) {
      extraBodyErrors.value[newKey] = extraBodyErrors.value[oldKey];
      delete extraBodyErrors.value[oldKey];
    }
    if (extraBodyDrafts.value[oldKey] !== undefined) {
      extraBodyDrafts.value[newKey] = extraBodyDrafts.value[oldKey];
      delete extraBodyDrafts.value[oldKey];
    }
  }

  function renameProviderExtraBodyState(oldProviderKey: string, newProviderKey: string): void {
    extraBodyErrors.value = configEditor.renameProviderScopedState(
      extraBodyErrors.value,
      oldProviderKey,
      newProviderKey,
    );
    extraBodyDrafts.value = configEditor.renameProviderScopedState(
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
      const models = configEditor.getRawModels(provider);
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
