<template>
  <div>
    <div class="config-page-header">
      <div>
        <h1 class="page-title">Config</h1>
        <p class="page-subtitle">
          Tune core runtime settings. Channel and plugin settings now live in their own pages.
        </p>
      </div>
      <div class="toolbar config-toolbar">
        <button class="btn btn-success" :disabled="saving" @click="saveConfig">
          {{ saving ? 'Saving...' : 'Save' }}
        </button>
        <button class="btn btn-ghost" @click="loadConfig">Reset</button>
      </div>
    </div>

    <div v-if="loading" class="empty-state">Loading configuration...</div>
    <div v-else-if="error" class="form-error">{{ error }}</div>
    <div v-else class="config-content">
      <section class="mcp-editor">
        <div class="mcp-editor-header">
          <div>
            <h2 class="section-title">Providers</h2>
            <p class="section-subtitle">
              Configure provider credentials, protocol type, base URLs, and model presets visually.
            </p>
          </div>
          <button type="button" class="btn btn-primary btn-sm" @click="addProvider">+ Add provider</button>
        </div>

        <div v-if="providerEntries.length === 0" class="empty-state mcp-empty">
          No providers configured.
        </div>

        <div v-for="provider in providerEntries" :key="provider.key" class="mcp-entry">
          <div class="mcp-entry-header">
            <div>
              <div class="mcp-entry-title">{{ provider.key || 'New provider' }}</div>
              <span class="badge badge-gray">{{ provider.apiType }}</span>
            </div>
            <button type="button" class="btn btn-danger btn-sm" @click="removeProvider(provider.key)">
              Remove
            </button>
          </div>

          <div class="mcp-fields">
            <div class="form-group">
              <label class="field-label">Provider key/name</label>
              <input
                :value="provider.key"
                class="form-input"
                placeholder="openai"
                @change="renameProvider(provider.key, ($event.target as HTMLInputElement).value)"
              />
            </div>

            <div class="form-group">
              <label class="field-label">API type</label>
              <select
                :value="provider.apiType"
                class="form-select"
                @change="updateProviderField(provider.key, 'apiType', ($event.target as HTMLSelectElement).value)"
              >
                <option value="openai_responses">openai_responses</option>
                <option value="openai_completion">openai_completion</option>
                <option value="anthropic">anthropic</option>
              </select>
            </div>

            <div class="form-group">
              <label class="field-label">Base URL</label>
              <input
                :value="provider.baseUrl ?? ''"
                class="form-input"
                placeholder="https://api.example.com/v1"
                @input="updateProviderOptionalString(provider.key, 'baseUrl', ($event.target as HTMLInputElement).value)"
              />
            </div>

            <div class="form-group mcp-wide">
              <label class="field-label">API key</label>
              <input
                :value="provider.apiKey ?? ''"
                type="text"
                class="form-input"
                placeholder="Provider API key"
                @input="updateProviderOptionalString(provider.key, 'apiKey', ($event.target as HTMLInputElement).value)"
              />
            </div>
          </div>

          <div class="model-editor">
            <div class="model-editor-header">
              <div>
                <div class="model-editor-title">Model presets</div>
                <p class="section-subtitle">Edit preset keys and common model fields while preserving future fields.</p>
              </div>
              <button type="button" class="btn btn-primary btn-sm" @click="addProviderModel(provider.key)">
                + Add model
              </button>
            </div>

            <div v-if="provider.models.length === 0" class="empty-state mcp-empty">
              No model presets configured.
            </div>

            <div v-for="model in provider.models" :key="model.key" class="model-entry">
              <div class="mcp-fields">
                <div class="form-group">
                  <label class="field-label">Model preset key</label>
                  <input
                    :value="model.key"
                    class="form-input"
                    placeholder="gpt-4o"
                    @change="renameProviderModel(provider.key, model.key, ($event.target as HTMLInputElement).value)"
                  />
                </div>

                <div class="form-group">
                  <label class="field-label">Context window</label>
                  <input
                    :value="model.contextWindow ?? ''"
                    type="number"
                    class="form-input"
                    placeholder="128000"
                    @input="updateProviderModelNumber(provider.key, model.key, ($event.target as HTMLInputElement).value)"
                  />
                </div>

                <button type="button" class="btn btn-danger btn-sm model-remove" @click="removeProviderModel(provider.key, model.key)">
                  Remove model
                </button>

                <div class="form-group mcp-wide">
                  <label class="field-label">Extra body JSON</label>
                  <JsonEditor
                    :model-value="toJson(model.extraBody ?? {})"
                    placeholder="{}"
                    @update:model-value="updateProviderModelExtraBody(provider.key, model.key, $event)"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section v-for="section in configSections" :key="section.key" class="mcp-editor">
        <div class="mcp-editor-header">
          <div>
            <h2 class="section-title">{{ section.title }}</h2>
            <p class="section-subtitle">{{ section.subtitle }}</p>
          </div>
        </div>

        <div v-if="section.key === 'server'" class="mcp-entry">
          <SchemaForm
            :schema="section.schema"
            :model-value="editableConfig[section.key]"
            @update:model-value="updateConfigSection(section.key, $event)"
          />
        </div>
        <div v-else class="agent-schema">
          <SchemaForm
            :schema="section.schema"
            :model-value="editableConfig[section.key]"
            @update:model-value="updateConfigSection(section.key, $event)"
          />
        </div>
      </section>

      <section v-if="configSections.length === 0" class="empty-state mcp-empty">
        No core configuration sections available.
      </section>

      <section class="mcp-editor">
        <div class="mcp-editor-header">
          <div>
            <h2 class="section-title">MCP servers</h2>
            <p class="section-subtitle">Configure enabled state, transport, connection details, args, and environment.</p>
          </div>
          <button type="button" class="btn btn-primary btn-sm" @click="addMcpServer">+ Add MCP</button>
        </div>

        <div v-if="mcpServers.length === 0" class="empty-state mcp-empty">
          No MCP servers configured.
        </div>

        <div v-for="(server, index) in mcpServers" :key="index" class="mcp-entry">
          <div class="mcp-entry-header">
            <div>
              <div class="mcp-entry-title">{{ server.name || `MCP server ${index + 1}` }}</div>
              <span class="badge" :class="server.enabled ? 'badge-green' : 'badge-gray'">
                {{ server.enabled ? 'Enabled' : 'Disabled' }}
              </span>
            </div>
            <button type="button" class="btn btn-danger btn-sm" @click="removeMcpServer(index)">
              Remove
            </button>
          </div>

          <div class="mcp-fields">
            <div class="form-group">
              <label class="field-label">Name</label>
              <input
                :value="server.name"
                class="form-input"
                placeholder="memory"
                @input="updateMcpField(index, 'name', ($event.target as HTMLInputElement).value)"
              />
            </div>

            <div class="form-group">
              <label class="field-label">Transport</label>
              <select
                :value="server.transport"
                class="form-select"
                @change="updateMcpField(index, 'transport', ($event.target as HTMLSelectElement).value)"
              >
                <option value="stdio">stdio</option>
                <option value="sse">sse</option>
                <option value="http">http</option>
              </select>
            </div>

            <div class="form-group toggle-group">
              <label class="field-label">Enabled</label>
              <button
                type="button"
                class="toggle-switch"
                :class="{ active: server.enabled }"
                @click="updateMcpField(index, 'enabled', !server.enabled)"
              >
                <span class="toggle-thumb"></span>
              </button>
            </div>

            <div v-if="server.transport === 'stdio'" class="form-group mcp-wide">
              <label class="field-label">Command</label>
              <input
                :value="server.command ?? ''"
                class="form-input"
                placeholder="npx"
                @input="updateOptionalStringField(index, 'command', ($event.target as HTMLInputElement).value)"
              />
            </div>

            <div v-else class="form-group mcp-wide">
              <label class="field-label">URL</label>
              <input
                :value="server.url ?? ''"
                class="form-input"
                placeholder="https://example.com/mcp"
                @input="updateOptionalStringField(index, 'url', ($event.target as HTMLInputElement).value)"
              />
            </div>

            <div class="form-group mcp-wide">
              <label class="field-label">Args</label>
              <textarea
                :value="argsToText(server.args)"
                class="form-textarea mcp-textarea"
                placeholder="One argument per line"
                @input="updateArgs(index, ($event.target as HTMLTextAreaElement).value)"
              ></textarea>
            </div>

            <div class="form-group mcp-wide">
              <label class="field-label">Environment</label>
              <textarea
                :value="envToText(server.env)"
                class="form-textarea mcp-textarea"
                placeholder="KEY=value, one per line"
                @input="updateEnv(index, ($event.target as HTMLTextAreaElement).value)"
              ></textarea>
            </div>
          </div>
        </div>
      </section>
    </div>

    <div v-if="toast" class="toast" :class="toast.type">{{ toast.message }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue';
import { useAuth } from '@/composables/useAuth';
import SchemaForm from '@/components/SchemaForm.vue';
import JsonEditor from '@/components/JsonEditor.vue';

type McpTransport = 'stdio' | 'sse' | 'http';

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

type ApiType = 'openai_responses' | 'openai_completion' | 'anthropic';

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

const { api } = useAuth();

const editableSchema = ref<Record<string, unknown>>({});
const editableConfig = ref<Record<string, unknown>>({});
const fullConfig = ref<Record<string, unknown>>({});
const loading = ref(true);
const saving = ref(false);
const error = ref('');

const toast = ref<{ type: string; message: string } | null>(null);
const excludedTopLevelKeys = new Set(['channels', 'plugins']);
const hiddenSchemaKeys = new Set(['channels', 'plugins', 'providers', 'mcp', 'cors']);

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
  const value = editableConfig.value.mcp;
  if (!Array.isArray(value)) return [];
  return value.map(normalizeMcpServer);
});

const providerEntries = computed<ProviderForm[]>(() => {
  const value = editableConfig.value.providers;
  if (!isRecord(value)) return [];
  return Object.entries(value).map(([key, provider]) => normalizeProvider(key, provider));
});

function showToast(type: string, message: string) {
  toast.value = { type, message };
  setTimeout(() => {
    toast.value = null;
  }, 3000);
}

async function loadSchema() {
  try {
    const res = await api.get('/config/schema');
    if (res.data.ok) {
      editableSchema.value = omitTopLevelSchemaProperties(res.data.data, hiddenSchemaKeys);
    }
  } catch (err) {
    console.error('Failed to load schema', err);
  }
}

async function loadConfig() {
  loading.value = true;
  error.value = '';
  try {
    const res = await api.get('/config');
    if (res.data.ok) {
      fullConfig.value = res.data.data;
      editableConfig.value = omitTopLevelConfigKeys(res.data.data, excludedTopLevelKeys);
    } else {
      error.value = res.data.error ?? 'Failed to load config';
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load config';
  } finally {
    loading.value = false;
  }
}

async function saveConfig() {
  saving.value = true;
  try {
    const res = await api.put('/config', editableConfig.value);
    if (res.data.ok) {
      fullConfig.value = { ...fullConfig.value, ...editableConfig.value };
      showToast('toast-success', 'Configuration saved successfully');
    } else {
      showToast('toast-error', res.data.error ?? 'Save failed');
    }
  } catch (err) {
    showToast('toast-error', err instanceof Error ? err.message : 'Save failed');
  } finally {
    saving.value = false;
  }
}

function updateConfigSection(key: string, value: unknown) {
  editableConfig.value = { ...editableConfig.value, [key]: value };
}

function addProvider() {
  const providers = getRawProviders();
  let nextKey = 'new-provider';
  let suffix = 1;
  while (Object.prototype.hasOwnProperty.call(providers, nextKey)) {
    suffix += 1;
    nextKey = `new-provider-${suffix}`;
  }
  editableConfig.value = {
    ...editableConfig.value,
    providers: { ...providers, [nextKey]: { apiType: 'openai_responses', models: {} } },
  };
}

function removeProvider(key: string) {
  const providers = getRawProviders();
  delete providers[key];
  editableConfig.value = { ...editableConfig.value, providers };
}

function renameProvider(oldKey: string, newKeyRaw: string) {
  const newKey = newKeyRaw.trim();
  const providers = getRawProviders();
  if (!newKey || newKey === oldKey) return;
  if (Object.prototype.hasOwnProperty.call(providers, newKey)) {
    showToast('toast-error', `A provider named "${newKey}" already exists`);
    return;
  }
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(providers)) {
    next[key === oldKey ? newKey : key] = value;
  }
  editableConfig.value = { ...editableConfig.value, providers: next };
}

function updateProviderField(providerKey: string, key: 'apiType', value: unknown) {
  updateProvider(providerKey, (provider) => ({ ...provider, [key]: isApiType(value) ? value : 'openai_responses' }));
}

function updateProviderOptionalString(providerKey: string, key: 'apiKey' | 'baseUrl', value: string) {
  updateProvider(providerKey, (provider) => updateOptionalProperty(provider, key, value));
}

function addProviderModel(providerKey: string) {
  updateProvider(providerKey, (provider) => {
    const models = getRawModels(provider);
    let nextKey = 'new-model';
    let suffix = 1;
    while (Object.prototype.hasOwnProperty.call(models, nextKey)) {
      suffix += 1;
      nextKey = `new-model-${suffix}`;
    }
    return { ...provider, models: { ...models, [nextKey]: {} } };
  });
}

function removeProviderModel(providerKey: string, modelKey: string) {
  updateProvider(providerKey, (provider) => {
    const models = getRawModels(provider);
    delete models[modelKey];
    return { ...provider, models };
  });
}

function renameProviderModel(providerKey: string, oldKey: string, newKeyRaw: string) {
  const newKey = newKeyRaw.trim();
  if (!newKey || newKey === oldKey) return;
  updateProvider(providerKey, (provider) => {
    const models = getRawModels(provider);
    if (Object.prototype.hasOwnProperty.call(models, newKey)) {
      showToast('toast-error', `A model preset named "${newKey}" already exists`);
      return provider;
    }
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(models)) {
      next[key === oldKey ? newKey : key] = value;
    }
    return { ...provider, models: next };
  });
}

function updateProviderModelNumber(providerKey: string, modelKey: string, value: string) {
  updateProviderModel(providerKey, modelKey, (model) => {
    const next = { ...model };
    const parsed = Number(value);
    if (value.trim() && Number.isFinite(parsed)) {
      next.contextWindow = parsed;
    } else {
      delete next.contextWindow;
    }
    return next;
  });
}

function updateProviderModelExtraBody(providerKey: string, modelKey: string, value: string) {
  const parsed = parseJson(value);
  if (parsed === undefined) return;
  updateProviderModel(providerKey, modelKey, (model) => {
    const next = { ...model };
    if (isRecord(parsed) && Object.keys(parsed).length > 0) {
      next.extraBody = parsed;
    } else {
      delete next.extraBody;
    }
    return next;
  });
}

function updateProvider(
  providerKey: string,
  updater: (provider: Record<string, unknown>) => Record<string, unknown>,
) {
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
) {
  updateProvider(providerKey, (provider) => {
    const models = getRawModels(provider);
    const current = models[modelKey];
    if (!isRecord(current)) return provider;
    models[modelKey] = updater(current);
    return { ...provider, models };
  });
}

function updateOptionalProperty(
  source: Record<string, unknown>,
  key: string,
  value: string,
): Record<string, unknown> {
  const next = { ...source };
  if (value.trim()) {
    next[key] = value;
  } else {
    delete next[key];
  }
  return next;
}

function addMcpServer() {
  const next = [...getRawMcpServers(), { name: '', transport: 'stdio', enabled: true }];
  editableConfig.value = { ...editableConfig.value, mcp: next };
}

function removeMcpServer(index: number) {
  const next = [...getRawMcpServers()];
  next.splice(index, 1);
  editableConfig.value = { ...editableConfig.value, mcp: next };
}

function updateMcpField(index: number, key: keyof McpServerForm, value: unknown) {
  const next = [...getRawMcpServers()];
  const current = next[index];
  if (!current) return;
  next[index] = { ...current, [key]: value };
  editableConfig.value = { ...editableConfig.value, mcp: next };
}

function updateOptionalStringField(index: number, key: 'command' | 'url', value: string) {
  const next = [...getRawMcpServers()];
  const current = next[index];
  if (!current) return;
  const updated = { ...current };
  if (value.trim()) {
    updated[key] = value;
  } else {
    delete updated[key];
  }
  next[index] = updated;
  editableConfig.value = { ...editableConfig.value, mcp: next };
}

function updateArgs(index: number, value: string) {
  const args = value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const next = [...getRawMcpServers()];
  const current = next[index];
  if (!current) return;
  const updated = { ...current };
  if (args.length > 0) {
    updated.args = args;
  } else {
    delete updated.args;
  }
  next[index] = updated;
  editableConfig.value = { ...editableConfig.value, mcp: next };
}

function updateEnv(index: number, value: string) {
  const env: Record<string, string> = {};
  for (const line of value.split('\n')) {
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    if (!key) continue;
    env[key] = line.slice(separatorIndex + 1);
  }

  const next = [...getRawMcpServers()];
  const current = next[index];
  if (!current) return;
  const updated = { ...current };
  if (Object.keys(env).length > 0) {
    updated.env = env;
  } else {
    delete updated.env;
  }
  next[index] = updated;
  editableConfig.value = { ...editableConfig.value, mcp: next };
}

function argsToText(value: unknown): string {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').join('\n') : '';
}

function envToText(value: unknown): string {
  if (!isStringRecord(value)) return '';
  return Object.entries(value)
    .map(([key, envValue]) => `${key}=${envValue}`)
    .join('\n');
}

function normalizeMcpServer(value: unknown): McpServerForm {
  const source = isRecord(value) ? value : {};
  return {
    ...source,
    name: typeof source.name === 'string' ? source.name : '',
    transport: isMcpTransport(source.transport) ? source.transport : 'stdio',
    enabled: typeof source.enabled === 'boolean' ? source.enabled : true,
    command: typeof source.command === 'string' ? source.command : undefined,
    args: Array.isArray(source.args)
      ? source.args.filter((item): item is string => typeof item === 'string')
      : undefined,
    env: isStringRecord(source.env) ? source.env : undefined,
    url: typeof source.url === 'string' ? source.url : undefined,
  };
}

function normalizeProvider(key: string, value: unknown): ProviderForm {
  const source = isRecord(value) ? value : {};
  return {
    ...source,
    key,
    apiType: isApiType(source.apiType) ? source.apiType : 'openai_responses',
    baseUrl: typeof source.baseUrl === 'string' ? source.baseUrl : undefined,
    apiKey: typeof source.apiKey === 'string' ? source.apiKey : undefined,
    models: normalizeProviderModels(source.models),
  };
}

function normalizeProviderModels(value: unknown): ProviderModelForm[] {
  if (!isRecord(value)) return [];
  return Object.entries(value).map(([key, model]) => {
    const source = isRecord(model) ? model : {};
    return {
      ...source,
      key,
      contextWindow: typeof source.contextWindow === 'number' ? source.contextWindow : undefined,
      extraBody: isRecord(source.extraBody) ? source.extraBody : undefined,
    };
  });
}

function getRawProviders(): Record<string, unknown> {
  const value = editableConfig.value.providers;
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, provider]) => [key, isRecord(provider) ? { ...provider } : {}]));
}

function getRawModels(provider: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(provider.models)) return {};
  return Object.fromEntries(Object.entries(provider.models).map(([key, model]) => [key, isRecord(model) ? { ...model } : {}]));
}

function getRawMcpServers(): Record<string, unknown>[] {
  const value = editableConfig.value.mcp;
  if (!Array.isArray(value)) return [];
  return value.map((item) => (isRecord(item) ? { ...item } : {}));
}

function isMcpTransport(value: unknown): value is McpTransport {
  return value === 'stdio' || value === 'sse' || value === 'http';
}

function isApiType(value: unknown): value is ApiType {
  return value === 'openai_responses' || value === 'openai_completion' || value === 'anthropic';
}

function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function parseJson(value: string): unknown | undefined {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function omitTopLevelConfigKeys(
  source: unknown,
  topLevelKeysToOmit: ReadonlySet<string>,
): Record<string, unknown> {
  if (!isRecord(source)) return {};
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (topLevelKeysToOmit.has(key.toLowerCase()) || key.toLowerCase() === 'cors') continue;
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
  if (isRecord(source.properties)) {
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(source.properties)) {
      if (!keysToOmit.has(key.toLowerCase())) properties[key] = value;
    }
    next.properties = properties;
  }
  if (Array.isArray(source.required)) {
    next.required = source.required.filter(
      (item): item is string => typeof item === 'string' && !keysToOmit.has(item.toLowerCase()),
    );
  }
  return next;
}

function getSchemaProperties(schema: JsonSchemaRecord): Record<string, unknown> {
  return isRecord(schema.properties) ? schema.properties : {};
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
  return subtitles[key] ?? 'Edit this config section while preserving unknown fields from the config API.';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === 'string');
}

onMounted(() => {
  void loadSchema();
  void loadConfig();
});
</script>

<style scoped>
.config-page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.page-subtitle,
.card-subtitle,
.summary-text {
  font-family: var(--font-body);
  color: var(--color-text-muted);
}

.page-subtitle {
  font-size: 0.9rem;
  margin: 0.25rem 0 0;
}

.config-toolbar {
  margin-bottom: 0;
  justify-content: flex-end;
}

.config-content {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.mcp-editor {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}



.mcp-editor-header,
.mcp-entry-header {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
}

.mcp-editor-header {
  align-items: flex-start;
}

.section-title,
.mcp-entry-title {
  font-family: var(--font-heading);
  color: var(--color-dark);
}

.section-title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 600;
}

.section-subtitle {
  margin: 0.2rem 0 0;
  color: var(--color-text-muted);
  font-family: var(--font-body);
  font-size: 0.82rem;
}

.mcp-entry {
  padding: 1rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  background: #FCFAF7;
  box-shadow: var(--shadow-sm);
}

.mcp-entry-header {
  align-items: center;
  margin-bottom: 1rem;
}

.mcp-entry-title {
  margin-bottom: 0.35rem;
  font-size: 0.95rem;
  font-weight: 600;
}

.mcp-fields {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
}

.mcp-wide {
  grid-column: 1 / -1;
}

.toggle-group {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.5rem;
}

.toggle-switch {
  width: 44px;
  height: 24px;
  border-radius: 12px;
  border: none;
  background: var(--color-border-strong);
  cursor: pointer;
  position: relative;
  transition: background var(--transition-fast);
  padding: 0;
}

.toggle-switch.active {
  background: var(--color-accent-green);
}

.toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
  transition: transform var(--transition-fast);
}

.toggle-switch.active .toggle-thumb {
  transform: translateX(20px);
}

.mcp-textarea {
  min-height: 76px;
  font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  font-size: 0.8rem;
}

.model-editor {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px dashed var(--color-border);
}

.model-editor-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.model-editor-title {
  font-family: var(--font-heading);
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-dark);
}

.model-entry {
  padding: 0.85rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  background: rgba(250, 249, 245, 0.75);
}

.model-remove {
  align-self: end;
  margin-bottom: 1.25rem;
}

:deep(.json-editor) {
  min-height: 90px;
  font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  font-size: 0.8rem;
}

.mcp-empty {
  border: 1px dashed var(--color-border);
  border-radius: var(--radius);
}

@media (max-width: 900px) {
  .config-page-header,
  .mcp-editor-header,
  .model-editor-header,
  .mcp-entry-header,
  .mcp-fields {
    display: flex;
    flex-direction: column;
  }

  .config-toolbar {
    width: 100%;
  }

  .mcp-toggle {
    align-self: flex-start;
  }
}
</style>

<style>
.agent-schema > .schema-form > .fieldset {
  padding: 1rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  background: #FCFAF7;
  box-shadow: var(--shadow-sm);
  margin-bottom: 1rem;
}
</style>
