import { computed, onMounted, readonly, ref } from 'vue';
import { rpcCall } from '@/lib/rpc';
import type { AppConfig, ProviderConfig, ProviderModelConfig } from '@/lib/types';

export function useConfigState(token: string | null) {
  const loading = ref(false);
  const saving = ref(false);
  const error = ref('');
  const saveMessage = ref('');
  const config = ref<AppConfig | null>(null);
  const configDraft = ref<AppConfig | null>(null);
  const providerExtraBodyDrafts = ref<Record<string, string>>({});
  const providerJsonErrors = ref<Record<string, { extraBody?: string }>>({});

  const providerEntries = computed(() => Object.entries(configDraft.value?.providers || {}) as Array<[string, ProviderConfig]>);
  const modelRefOptions = computed(() => {
    const refs: string[] = [];
    for (const [providerName, provider] of Object.entries(configDraft.value?.providers || {})) {
      for (const modelName of Object.keys(provider.models || {})) {
        refs.push(`${providerName}/${modelName}`);
      }
    }
    return refs.sort((left, right) => left.localeCompare(right));
  });
  const hasProviderJsonErrors = computed(() => Object.values(providerJsonErrors.value).some((item) => Boolean(item?.extraBody)));

  function createEmptyProvider(): ProviderConfig {
    return {
      type: 'openai',
      apiKey: '',
      apiBase: '',
      headers: {},
      extraBody: {},
      models: {}
    };
  }

  function createEmptyModel(): ProviderModelConfig {
    return {
      maxContextTokens: undefined,
      reasoning: false,
      supportsVision: false
    };
  }

  function formatJsonObject(value: Record<string, unknown> | undefined) {
    return JSON.stringify(value || {}, null, 2);
  }

  function parseJsonObject(text: string, label: string): Record<string, unknown> {
    const trimmed = text.trim();
    if (!trimmed) {
      return {};
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error(`${label} 必须是有效的 JSON 格式`);
    }

    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new Error(`${label} 必须是 JSON 对象`);
    }

    return parsed as Record<string, unknown>;
  }

  function syncProviderEditors() {
    const providers = configDraft.value?.providers || {};
    providerExtraBodyDrafts.value = {};
    providerJsonErrors.value = {};

    for (const [name, provider] of Object.entries(providers)) {
      providerExtraBodyDrafts.value[name] = formatJsonObject(provider.extraBody as Record<string, unknown> | undefined);
    }
  }

  function updateProviderExtraBodyDraft(name: string, value: string) {
    if (!configDraft.value?.providers?.[name]) {
      return;
    }

    providerExtraBodyDrafts.value[name] = value;
    const nextErrors = { ...(providerJsonErrors.value[name] || {}) };

    try {
      configDraft.value.providers[name].extraBody = parseJsonObject(value, 'Extra Body');
      delete nextErrors.extraBody;
    } catch (parseError) {
      nextErrors.extraBody = parseError instanceof Error ? parseError.message : 'JSON 解析失败';
    }

    providerJsonErrors.value[name] = nextErrors;
  }

  function rewriteModelReferences(rewriter: (ref: string) => string) {
    if (!configDraft.value) {
      return;
    }

    const roles = configDraft.value.agents?.roles || {};
    for (const role of Object.values(roles)) {
      if (!role) {
        continue;
      }
      role.model = rewriter(role.model || '');
    }

    const defaults = configDraft.value.agent?.defaults;
    if (!defaults) {
      return;
    }

    defaults.visionFallbackModel = rewriter(defaults.visionFallbackModel || '');
    defaults.memorySummary!.model = rewriter(defaults.memorySummary!.model || '');
    defaults.memoryFacts!.model = rewriter(defaults.memoryFacts!.model || '');
    defaults.memoryFacts!.retrievalModel = rewriter(defaults.memoryFacts!.retrievalModel || '');
  }

  function addProvider() {
    if (!configDraft.value) {
      return;
    }

    let index = 1;
    let name = `provider${index}`;
    while (configDraft.value.providers?.[name]) {
      index += 1;
      name = `provider${index}`;
    }

    configDraft.value.providers ||= {};
    configDraft.value.providers[name] = createEmptyProvider();
    syncProviderEditors();
  }

  function renameProvider(oldName: string, nextNameRaw: string) {
    if (!configDraft.value?.providers) {
      return;
    }

    const nextName = nextNameRaw.trim();
    if (!nextName || nextName === oldName) {
      return;
    }
    if (configDraft.value.providers[nextName]) {
      error.value = `Provider 名称 "${nextName}" 已存在`;
      return;
    }

    const nextProviders: Record<string, ProviderConfig> = {};
    for (const [name, provider] of Object.entries(configDraft.value.providers)) {
      nextProviders[name === oldName ? nextName : name] = provider;
    }
    configDraft.value.providers = nextProviders;
    rewriteModelReferences((ref) => ref.startsWith(`${oldName}/`) ? `${nextName}/${ref.slice(oldName.length + 1)}` : ref);
    error.value = '';
    syncProviderEditors();
  }

  function removeProvider(name: string) {
    if (!configDraft.value?.providers?.[name]) {
      return;
    }

    delete configDraft.value.providers[name];
    rewriteModelReferences((ref) => ref.startsWith(`${name}/`) ? '' : ref);
    syncProviderEditors();
  }

  function addModel(providerName: string) {
    const provider = configDraft.value?.providers?.[providerName];
    if (!provider) {
      return;
    }

    provider.models ||= {};
    let index = 1;
    let name = `model${index}`;
    while (provider.models[name]) {
      index += 1;
      name = `model${index}`;
    }
    provider.models[name] = createEmptyModel();
  }

  function renameModel(providerName: string, oldModelName: string, nextModelNameRaw: string) {
    const provider = configDraft.value?.providers?.[providerName];
    if (!provider?.models) {
      return;
    }

    const nextModelName = nextModelNameRaw.trim();
    if (!nextModelName || nextModelName === oldModelName) {
      return;
    }
    if (provider.models[nextModelName]) {
      error.value = `模型名 "${providerName}/${nextModelName}" 已存在`;
      return;
    }

    const nextModels: Record<string, ProviderModelConfig> = {};
    for (const [modelName, modelConfig] of Object.entries(provider.models)) {
      nextModels[modelName === oldModelName ? nextModelName : modelName] = modelConfig;
    }
    provider.models = nextModels;
    rewriteModelReferences((ref) => ref === `${providerName}/${oldModelName}` ? `${providerName}/${nextModelName}` : ref);
    error.value = '';
  }

  function removeModel(providerName: string, modelName: string) {
    const provider = configDraft.value?.providers?.[providerName];
    if (!provider?.models?.[modelName]) {
      return;
    }

    delete provider.models[modelName];
    rewriteModelReferences((ref) => ref === `${providerName}/${modelName}` ? '' : ref);
  }

  function normalizeConfig(source: AppConfig): AppConfig {
    const next = structuredClone(source || {});

    next.server ||= { host: '0.0.0.0', apiPort: 18792, apiEnabled: true };
    next.agent ||= { defaults: {} };
    next.agent.defaults ||= {};
    next.agent.defaults.visionFallbackModel ||= '';
    next.agent.defaults.memorySummary ||= { enabled: false, model: '', compressRounds: 5 };
    next.agent.defaults.memoryFacts ||= {
      enabled: false,
      model: '',
      retrievalModel: '',
      retrievalThreshold: 0.59,
      retrievalTopK: 5
    };
    next.agents ||= { roles: {} };
    next.agents.roles ||= {};
    next.agents.roles.main ||= {
      name: 'main',
      description: '',
      model: '',
      systemPrompt: '',
      allowedSkills: [],
      allowedTools: []
    };
    next.providers ||= {};
    for (const provider of Object.values(next.providers)) {
      provider.headers ||= {};
      provider.extraBody ||= {};
      provider.models ||= {};
    }
    next.channels ||= {};
    next.plugins ||= {};
    next.skills ||= {};
    next.mcp ||= {};
    next.observability ||= { level: 'info' };
    next.tools ||= { timeoutMs: 120000 };

    return next;
  }

  async function loadConfig() {
    loading.value = true;
    error.value = '';
    saveMessage.value = '';

    const result = await rpcCall<AppConfig>('config.get', token);
    if (result.error || !result.data) {
      error.value = result.error || '配置加载失败';
      loading.value = false;
      return;
    }

    config.value = normalizeConfig(result.data);
    configDraft.value = normalizeConfig(result.data);
    syncProviderEditors();
    loading.value = false;
  }

  function resetDraft() {
    if (!config.value) {
      return;
    }

    configDraft.value = normalizeConfig(config.value);
    saveMessage.value = '';
    syncProviderEditors();
  }

  async function saveConfig() {
    if (!configDraft.value) {
      return;
    }
    if (hasProviderJsonErrors.value) {
      error.value = 'Provider 配置存在格式错误，请先修正后再保存';
      return;
    }

    saving.value = true;
    error.value = '';
    const result = await rpcCall<{ success: true }>('config.update', token, configDraft.value);
    saving.value = false;

    if (result.error) {
      error.value = result.error;
      return;
    }

    config.value = normalizeConfig(configDraft.value);
    syncProviderEditors();
    saveMessage.value = '配置已保存。部分模块可能需要重启后生效。';
  }

  onMounted(() => {
    void loadConfig();
  });

  return {
    loading: readonly(loading),
    saving: readonly(saving),
    error: readonly(error),
    saveMessage: readonly(saveMessage),
    configDraft,
    providerExtraBodyDrafts: readonly(providerExtraBodyDrafts),
    providerJsonErrors: readonly(providerJsonErrors),
    providerEntries,
    modelRefOptions,
    loadConfig,
    resetDraft,
    saveConfig,
    updateProviderExtraBodyDraft,
    addProvider,
    renameProvider,
    removeProvider,
    addModel,
    renameModel,
    removeModel
  };
}
