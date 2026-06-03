<template>
  <section class="config-editor card">
    <div class="editor-header">
      <div>
        <h2 class="section-title">{{ title }}</h2>
        <p class="editor-subtitle">{{ subtitle }}</p>
      </div>
      <div class="editor-actions">
        <button
          class="save-btn"
          :disabled="!channelReady || saving || hasBlockingErrors"
          @click="saveSection"
        >
          {{ saving ? 'Saving…' : 'Save' }}
        </button>
        <button class="secondary-btn" :disabled="!channelReady || loading" @click="resetSection">
          Reset
        </button>
      </div>
    </div>

    <p v-if="!channelReady" class="status-text muted">
      Waiting for the Desktop channel connection before loading configuration.
    </p>
    <p v-else-if="loading" class="status-text muted">
      Loading {{ title.toLowerCase() }} configuration…
    </p>
    <p v-else-if="error" class="status-text error">{{ error }}</p>
    <p v-else-if="feedback" class="status-text" :class="feedbackType">{{ feedback }}</p>

    <div v-if="channelReady && !loading && !error" class="editor-body">
      <div v-if="itemCount === 0" class="empty-state">
        No {{ entryNoun }} configuration entries.
      </div>

      <template v-if="sectionKey === 'channels'">
        <article v-for="entry in entries" :key="entry.key" class="config-entry">
          <div class="entry-header">
            <div class="entry-title">{{ entry.key || 'New channel' }}</div>
            <div class="entry-controls">
              <label class="toggle-label">Enabled</label>
              <ToggleSwitch
                :model-value="getEntryEnabled(entry)"
                :disabled="saving"
                @update:model-value="toggleEntryEnabled(entry.key)"
              />
              <button
                class="danger-btn"
                type="button"
                title="Remove channel"
                @click="removeEntry(entry.key)"
              >
                ×
              </button>
            </div>
          </div>

          <div class="fields-title">Configuration</div>
          <div v-if="getEntryFields(entry).length === 0" class="empty-inline">
            No editable fields.
          </div>
          <div v-else class="field-grid">
            <div
              v-for="field in getEntryFields(entry)"
              :key="`${entry.key}-${field.key}`"
              class="field-block"
            >
              <label class="field-label">{{ field.displayLabel }}</label>
              <ToggleSwitch
                v-if="field.type === 'boolean'"
                :model-value="Boolean(field.value)"
                @update:model-value="setEntryField(entry.key, field.path, $event)"
              />
              <input
                v-else-if="field.type === 'number'"
                :value="field.value"
                type="number"
                class="field-input"
                @input="
                  setEntryNumberField(
                    entry.key,
                    field.path,
                    ($event.target as HTMLInputElement).value,
                  )
                "
              />
              <template v-else-if="field.type === 'object'">
                <textarea
                  :value="configEditor.toJson(field.value)"
                  class="field-input json-input"
                  rows="3"
                  @input="
                    handleEntryComplexField(
                      entry.key,
                      field.path,
                      ($event.target as HTMLTextAreaElement).value,
                    )
                  "
                />
                <p
                  v-if="getComplexFieldError(`${props.sectionKey}.${entry.key}.${field.path}`)"
                  class="status-text error field-error"
                >
                  {{ getComplexFieldError(`${props.sectionKey}.${entry.key}.${field.path}`) }}
                </p>
              </template>
              <select
                v-else-if="field.path === 'defaultModel' && modelOptions.length"
                :value="field.value"
                class="field-input"
                @change="
                  setEntryField(entry.key, field.path, ($event.target as HTMLSelectElement).value)
                "
              >
                <option value="" disabled>Select a model</option>
                <option v-for="opt in modelOptions" :key="opt.value" :value="opt.value">
                  {{ opt.label }}
                </option>
              </select>
              <input
                v-else
                :value="field.value"
                class="field-input"
                @input="
                  setEntryField(entry.key, field.path, ($event.target as HTMLInputElement).value)
                "
              />
            </div>
          </div>
        </article>
      </template>

      <template v-else-if="sectionKey === 'plugins'">
        <article v-for="entry in entries" :key="entry.key" class="config-entry">
          <div class="entry-header">
            <div class="entry-title">{{ entry.key || entry.key }}</div>
            <div class="entry-controls">
              <label class="toggle-label">Enabled</label>
              <ToggleSwitch
                :model-value="getEntryEnabled(entry)"
                :disabled="saving"
                @update:model-value="toggleEntryEnabled(entry.key)"
              />
              <button
                class="danger-btn"
                type="button"
                title="Remove plugin"
                @click="removeEntry(entry.key)"
              >
                ×
              </button>
            </div>
          </div>

          <div class="fields-title">Options</div>
          <div v-if="getEntryFields(entry).length === 0" class="empty-inline">No options.</div>
          <div v-else class="field-grid">
            <div
              v-for="field in getEntryFields(entry)"
              :key="`${entry.key}-${field.key}`"
              class="field-block"
            >
              <label class="field-label">{{ field.displayLabel }}</label>
              <ToggleSwitch
                v-if="field.type === 'boolean'"
                :model-value="Boolean(field.value)"
                @update:model-value="setEntryField(entry.key, field.path, $event)"
              />
              <input
                v-else-if="field.type === 'number'"
                :value="field.value"
                type="number"
                class="field-input"
                @input="
                  setEntryNumberField(
                    entry.key,
                    field.path,
                    ($event.target as HTMLInputElement).value,
                  )
                "
              />
              <template v-else-if="field.type === 'object'">
                <textarea
                  :value="configEditor.toJson(field.value)"
                  class="field-input json-input"
                  rows="3"
                  @input="
                    handleEntryComplexField(
                      entry.key,
                      field.path,
                      ($event.target as HTMLTextAreaElement).value,
                    )
                  "
                />
                <p
                  v-if="getComplexFieldError(`plugins.${entry.key}.${field.path}`)"
                  class="status-text error field-error"
                >
                  {{ getComplexFieldError(`plugins.${entry.key}.${field.path}`) }}
                </p>
              </template>
              <input
                v-else
                :value="field.value"
                class="field-input"
                @input="
                  setEntryField(entry.key, field.path, ($event.target as HTMLInputElement).value)
                "
              />
            </div>
          </div>
        </article>
      </template>

      <template v-else-if="sectionKey === 'providers'">
        <div class="section-toolbar">
          <button type="button" class="add-btn" @click="addProvider">+ Add provider</button>
        </div>
        <article v-for="provider in providerEntries" :key="provider.key" class="config-entry">
          <div class="entry-header with-margin">
            <div>
              <div class="entry-title">{{ provider.key || 'New provider' }}</div>
              <span class="pill">{{ provider.apiType }}</span>
            </div>
            <button
              class="danger-btn"
              type="button"
              title="Remove provider"
              @click="removeProvider(provider.key)"
            >
              ×
            </button>
          </div>

          <div class="field-grid three-col">
            <div class="field-block">
              <label class="field-label">Provider key/name</label>
              <input
                :value="provider.key"
                class="field-input"
                placeholder="openai"
                @change="renameProvider(provider.key, ($event.target as HTMLInputElement).value)"
              />
            </div>
            <div class="field-block">
              <label class="field-label">API type</label>
              <select
                :value="provider.apiType"
                class="field-input"
                @change="
                  updateProviderField(
                    provider.key,
                    'apiType',
                    ($event.target as HTMLSelectElement).value,
                  )
                "
              >
                <option value="openai-responses">openai-responses</option>
                <option value="openai-completions">openai-completions</option>
                <option value="anthropic-messages">anthropic-messages</option>
              </select>
            </div>
            <div class="field-block">
              <label class="field-label">Base URL</label>
              <input
                :value="provider.baseUrl ?? ''"
                class="field-input"
                placeholder="https://api.example.com/v1"
                @input="
                  updateProviderOptionalString(
                    provider.key,
                    'baseUrl',
                    ($event.target as HTMLInputElement).value,
                  )
                "
              />
            </div>
            <div class="field-block full-span">
              <label class="field-label">API key</label>
              <input
                :value="provider.apiKey ?? ''"
                class="field-input"
                placeholder="Provider API key"
                @input="
                  updateProviderOptionalString(
                    provider.key,
                    'apiKey',
                    ($event.target as HTMLInputElement).value,
                  )
                "
              />
            </div>
          </div>

          <div class="subsection-header">
            <div>
              <div class="subsection-title">Model presets</div>
              <p class="empty-inline">Edit preset keys and common model fields.</p>
            </div>
            <button type="button" class="add-btn dark" @click="addProviderModel(provider.key)">
              + Add model
            </button>
          </div>

          <div v-if="provider.models.length === 0" class="empty-state compact">
            No model presets configured.
          </div>
          <article v-for="model in provider.models" :key="model.key" class="nested-entry">
            <div class="field-grid three-col">
              <div class="field-block">
                <label class="field-label">Model preset key</label>
                <input
                  :value="model.key"
                  class="field-input"
                  placeholder="gpt-4o"
                  @change="
                    renameProviderModel(
                      provider.key,
                      model.key,
                      ($event.target as HTMLInputElement).value,
                    )
                  "
                />
              </div>
              <div class="field-block">
                <label class="field-label">Context window</label>
                <input
                  :value="model.contextWindow ?? ''"
                  type="number"
                  class="field-input"
                  placeholder="128000"
                  @input="
                    updateProviderModelNumber(
                      provider.key,
                      model.key,
                      ($event.target as HTMLInputElement).value,
                    )
                  "
                />
              </div>
              <button
                type="button"
                class="danger-btn model-remove"
                title="Remove model"
                @click="removeProviderModel(provider.key, model.key)"
              >
                ×
              </button>
              <div class="field-block full-span">
                <label class="field-label">Extra body JSON</label>
                <textarea
                  :value="getExtraBodyText(provider.key, model.key, model.extraBody ?? {})"
                  class="field-input json-input"
                  rows="4"
                  placeholder="{}"
                  @input="
                    updateProviderModelExtraBody(
                      provider.key,
                      model.key,
                      ($event.target as HTMLTextAreaElement).value,
                    )
                  "
                />
                <p
                  v-if="getExtraBodyError(provider.key, model.key)"
                  class="status-text error field-error"
                >
                  {{ getExtraBodyError(provider.key, model.key) }}
                </p>
              </div>
            </div>
          </article>
        </article>
      </template>

      <template v-else-if="sectionKey === 'mcp'">
        <div class="section-toolbar">
          <button type="button" class="add-btn" @click="addMcpServer">+ Add MCP</button>
        </div>
        <article
          v-for="(server, index) in mcpServers"
          :key="`${server.name}-${index}`"
          class="config-entry"
        >
          <div class="entry-header with-margin">
            <div>
              <div class="entry-title">{{ server.name || `MCP server ${index + 1}` }}</div>
              <span class="pill" :class="{ enabled: server.enabled }">
                {{ server.enabled ? 'Enabled' : 'Disabled' }}
              </span>
            </div>
            <button
              class="danger-btn"
              type="button"
              title="Remove MCP"
              @click="removeMcpServer(index)"
            >
              ×
            </button>
          </div>

          <div class="field-grid three-col">
            <div class="field-block">
              <label class="field-label">Name</label>
              <input
                :value="server.name"
                class="field-input"
                placeholder="memory"
                @input="updateMcpField(index, 'name', ($event.target as HTMLInputElement).value)"
              />
            </div>
            <div class="field-block">
              <label class="field-label">Transport</label>
              <select
                :value="server.transport"
                class="field-input"
                @change="
                  updateMcpField(index, 'transport', ($event.target as HTMLSelectElement).value)
                "
              >
                <option value="stdio">stdio</option>
                <option value="sse">sse</option>
                <option value="http">http</option>
              </select>
            </div>
            <div class="field-block toggle-block">
              <label class="field-label">Enabled</label>
              <ToggleSwitch
                :model-value="server.enabled"
                @update:model-value="updateMcpField(index, 'enabled', $event)"
              />
            </div>
            <div v-if="server.transport === 'stdio'" class="field-block full-span">
              <label class="field-label">Command</label>
              <input
                :value="server.command ?? ''"
                class="field-input"
                placeholder="npx"
                @input="
                  updateOptionalStringField(
                    index,
                    'command',
                    ($event.target as HTMLInputElement).value,
                  )
                "
              />
            </div>
            <div v-else class="field-block full-span">
              <label class="field-label">URL</label>
              <input
                :value="server.url ?? ''"
                class="field-input"
                placeholder="https://example.com/mcp"
                @input="
                  updateOptionalStringField(index, 'url', ($event.target as HTMLInputElement).value)
                "
              />
            </div>
            <div class="field-block full-span">
              <label class="field-label">Args</label>
              <textarea
                :value="argsToText(server.args)"
                class="field-input json-input"
                rows="3"
                placeholder="One argument per line"
                @input="updateArgs(index, ($event.target as HTMLTextAreaElement).value)"
              />
            </div>
            <div class="field-block full-span">
              <label class="field-label">Environment</label>
              <textarea
                :value="envToText(server.env)"
                class="field-input json-input"
                rows="3"
                placeholder="KEY=value, one per line"
                @input="updateEnv(index, ($event.target as HTMLTextAreaElement).value)"
              />
            </div>
          </div>
        </article>
      </template>

      <template v-else>
        <article class="config-entry">
          <div v-if="genericFields.length === 0" class="empty-inline">No editable fields.</div>
          <div v-else class="field-grid">
            <div v-for="field in genericFields" :key="field.key" class="field-block">
              <label class="field-label">{{ field.displayLabel }}</label>
              <ToggleSwitch
                v-if="field.type === 'boolean'"
                :model-value="Boolean(field.value)"
                @update:model-value="setGenericField(field.path, $event)"
              />
              <input
                v-else-if="field.type === 'number'"
                :value="field.value"
                type="number"
                class="field-input"
                @input="
                  setGenericNumberField(field.path, ($event.target as HTMLInputElement).value)
                "
              />
              <template v-else-if="field.type === 'object'">
                <textarea
                  :value="configEditor.toJson(field.value)"
                  class="field-input json-input"
                  rows="3"
                  @input="
                    handleGenericComplexField(
                      field.path,
                      ($event.target as HTMLTextAreaElement).value,
                    )
                  "
                />
                <p
                  v-if="getComplexFieldError(`generic.${field.path}`)"
                  class="status-text error field-error"
                >
                  {{ getComplexFieldError(`generic.${field.path}`) }}
                </p>
              </template>
              <input
                v-else
                :value="field.value"
                class="field-input"
                @input="setGenericField(field.path, ($event.target as HTMLInputElement).value)"
              />
            </div>
          </div>
        </article>
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import ToggleSwitch from './ToggleSwitch.vue';
import { toIpcCloneable } from '../../shared/ipc-clone';

import type {
  ChannelEntry,
  ConfigField,
  ConfigSectionKey,
  McpServerForm,
  ProviderForm,
} from '../config-editor/types';
import * as configEditor from '../config-editor/utils';

let cachedConfig: Record<string, unknown> | null = null;
let pendingConfigLoad: Promise<Record<string, unknown>> | null = null;

async function requestChannelRaw<T = unknown>(type: string, payload?: unknown): Promise<T> {
  const response = await window.aesyclaw.channelRequest(type, payload);
  if (!response.ok) {
    throw new Error(response.error ?? `${type} failed`);
  }
  return response.data as T;
}

async function loadSharedConfig(force = false): Promise<Record<string, unknown>> {
  if (!force && cachedConfig !== null) return cachedConfig;
  if (!force && pendingConfigLoad !== null) return await pendingConfigLoad;

  pendingConfigLoad = requestChannelRaw<Record<string, unknown>>('get_config');
  try {
    cachedConfig = await pendingConfigLoad;
    return cachedConfig;
  } finally {
    pendingConfigLoad = null;
  }
}

function updateCachedConfigSection(key: ConfigSectionKey, value: unknown): void {
  cachedConfig = { ...(cachedConfig ?? {}), [key]: value };
}

const props = defineProps<{
  sectionKey: ConfigSectionKey;
  title: string;
  subtitle: string;
  channelReady: boolean;
}>();

const sectionValue = ref<unknown>(configEditor.getDefaultSectionValue(props.sectionKey));
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const feedback = ref('');
const feedbackType = ref<'success' | 'error'>('success');
const extraBodyErrors = ref<Record<string, string>>({});
const extraBodyDrafts = ref<Record<string, string>>({});
const complexFieldErrors = ref<Record<string, string>>({});

const hasExtraBodyErrors = computed(() => Object.keys(extraBodyErrors.value).length > 0);
const hasComplexFieldErrors = computed(() => Object.keys(complexFieldErrors.value).length > 0);
const hasBlockingErrors = computed(() => hasExtraBodyErrors.value || hasComplexFieldErrors.value);
const sectionKey = computed(() => props.sectionKey);
const entryNoun = computed(() => {
  if (props.sectionKey === 'plugins') return 'plugin';
  if (props.sectionKey === 'channels') return 'channel';
  return 'section';
});

const itemCount = computed(() => {
  if (props.sectionKey === 'providers') return providerEntries.value.length;
  if (props.sectionKey === 'mcp') return mcpServers.value.length;
  if (props.sectionKey !== 'channels' && props.sectionKey !== 'plugins')
    return genericFields.value.length;
  if (configEditor.isRecord(sectionValue.value)) return Object.keys(sectionValue.value).length;
  return 0;
});

const entries = computed<ChannelEntry[]>(() => {
  if (!configEditor.isRecord(sectionValue.value)) return [];
  return Object.entries(sectionValue.value).map(([key, value]) => ({ key, value }));
});

const providerEntries = computed<ProviderForm[]>(() => {
  if (!configEditor.isRecord(sectionValue.value)) return [];
  return Object.entries(sectionValue.value).map(([key, provider]) =>
    configEditor.normalizeProvider(key, provider),
  );
});

const mcpServers = computed<McpServerForm[]>(() => {
  return Array.isArray(sectionValue.value)
    ? sectionValue.value.map(configEditor.normalizeMcpServer)
    : [];
});

const genericFields = computed<ConfigField[]>(() => {
  return configEditor.isRecord(sectionValue.value) ? getFields(sectionValue.value) : [];
});

const rawConfig = ref<Record<string, unknown>>({});

const modelOptions = computed<Array<{ value: string; label: string }>>(() => {
  const providers = rawConfig.value['providers'];
  const opts: Array<{ value: string; label: string }> = [];
  if (configEditor.isRecord(providers)) {
    for (const [providerName, providerCfg] of Object.entries(providers)) {
      if (configEditor.isRecord(providerCfg)) {
        const models = (providerCfg as Record<string, unknown>)['models'];
        if (configEditor.isRecord(models)) {
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

async function loadConfig(force = false): Promise<void> {
  if (!props.channelReady) return;
  loading.value = true;
  error.value = '';
  feedback.value = '';
  extraBodyErrors.value = {};
  complexFieldErrors.value = {};
  try {
    const config = await loadSharedConfig(force);
    rawConfig.value = config;
    sectionValue.value = configEditor.getSectionValue(config, props.sectionKey);
    extraBodyDrafts.value = {};
  } catch (err) {
    error.value = err instanceof Error ? err.message : `Failed to load ${props.sectionKey} config`;
  } finally {
    loading.value = false;
  }
}

async function saveSection(): Promise<void> {
  if (!props.channelReady) return;
  if (hasBlockingErrors.value) return;
  saving.value = true;
  error.value = '';
  feedback.value = '';
  try {
    const plainSectionValue = toIpcCloneable(sectionValue.value);
    await requestChannel('update_config', { [props.sectionKey]: plainSectionValue });
    updateCachedConfigSection(props.sectionKey, plainSectionValue);
    feedbackType.value = 'success';
    feedback.value = `${props.title} configuration saved`;
  } catch (err) {
    feedbackType.value = 'error';
    feedback.value = err instanceof Error ? err.message : 'Save failed';
  } finally {
    saving.value = false;
  }
}

async function requestChannel<T = unknown>(type: string, payload?: unknown): Promise<T> {
  return await requestChannelRaw<T>(type, payload);
}

function resetSection(): void {
  void loadConfig(true);
}

// ─── Shared entry functions (channels + plugins) ──────────────────────

function removeEntry(key: string): void {
  if (!configEditor.isRecord(sectionValue.value)) return;
  const next = { ...sectionValue.value };
  delete next[key];
  sectionValue.value = next;
}

function getEntryEnabled(entry: ChannelEntry): boolean {
  return configEditor.isRecord(entry.value) && typeof entry.value['enabled'] === 'boolean'
    ? entry.value['enabled']
    : true;
}

async function toggleEntryEnabled(key: string): Promise<void> {
  const current = configEditor.isRecord(sectionValue.value) ? sectionValue.value : {};
  const entryValue = configEditor.isRecord(current[key]) ? current[key] : {};
  const enabled = entryValue['enabled'] === false;
  sectionValue.value = { ...current, [key]: { ...entryValue, enabled } };

  try {
    const wsType = props.sectionKey === 'plugins' ? 'set_plugin_enabled' : 'set_channel_enabled';
    await requestChannel(wsType, { name: key, enabled });
    feedbackType.value = 'success';
    feedback.value = `${key} ${enabled ? 'enabled' : 'disabled'}`;
  } catch (err) {
    sectionValue.value = current;
    feedbackType.value = 'error';
    feedback.value = err instanceof Error ? err.message : 'Failed to update';
  }
}

function getEntryFields(entry: ChannelEntry): ConfigField[] {
  return configEditor.isRecord(entry.value) ? getFields(entry.value, ['enabled']) : [];
}

function setEntryField(entryKey: string, path: string, value: unknown): void {
  const current = configEditor.isRecord(sectionValue.value) ? sectionValue.value : {};
  const entryConfig = configEditor.isRecord(current[entryKey]) ? { ...current[entryKey] } : {};
  setNestedValue(entryConfig, path, value);
  sectionValue.value = { ...current, [entryKey]: entryConfig };
}

function setEntryNumberField(entryKey: string, path: string, raw: string): void {
  const parsed = parseNumberInput(raw);
  if (parsed === null) return;
  setEntryField(entryKey, path, parsed);
}

function handleEntryComplexField(entryKey: string, path: string, raw: string): void {
  const errorKey = `${props.sectionKey}.${entryKey}.${path}`;
  handleComplexField(errorKey, raw, (parsed) => setEntryField(entryKey, path, parsed));
}

function handleComplexField(
  errorKey: string,
  raw: string,
  setParsed: (value: unknown) => void,
): void {
  try {
    setParsed(JSON.parse(raw) as unknown);
    clearComplexFieldError(errorKey);
  } catch (err) {
    setComplexFieldError(errorKey, err instanceof Error ? err.message : 'Invalid JSON');
  }
}

function getComplexFieldError(errorKey: string): string {
  return complexFieldErrors.value[errorKey] ?? '';
}

function setComplexFieldError(errorKey: string, message: string): void {
  complexFieldErrors.value = { ...complexFieldErrors.value, [errorKey]: message };
}

function clearComplexFieldError(errorKey: string): void {
  if (!Object.hasOwn(complexFieldErrors.value, errorKey)) return;
  const next = { ...complexFieldErrors.value };
  delete next[errorKey];
  complexFieldErrors.value = next;
}

function setGenericField(path: string, value: unknown): void {
  const current = configEditor.isRecord(sectionValue.value) ? { ...sectionValue.value } : {};
  setNestedValue(current, path, value);
  sectionValue.value = current;
}

function setGenericNumberField(path: string, raw: string): void {
  const parsed = parseNumberInput(raw);
  if (parsed === null) return;
  setGenericField(path, parsed);
}

function handleGenericComplexField(path: string, raw: string): void {
  handleComplexField(`generic.${path}`, raw, (parsed) => setGenericField(path, parsed));
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function flattenObject(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isRecord(val) && Object.keys(val).length > 0) {
      Object.assign(result, flattenObject(val, path));
    } else {
      result[path] = val;
    }
  }
  return result;
}

function getFields(record: Record<string, unknown>, skipKeys: string[] = []): ConfigField[] {
  const fields: ConfigField[] = [];
  const skip = new Set(skipKeys);
  const flat = flattenObject(record);
  for (const [key, val] of Object.entries(flat)) {
    if (skip.has(key)) continue;
    let type: ConfigField['type'] = 'string';
    if (typeof val === 'number') type = 'number';
    else if (typeof val === 'boolean') type = 'boolean';
    else if (typeof val === 'object' && val !== null) type = 'object';
    fields.push({
      path: key,
      key,
      displayLabel: configEditor.formatFieldLabel(key),
      value: val,
      type,
    });
  }
  return fields;
}

function parseNumberInput(raw: string): number | null {
  if (raw.trim() === '') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function addProvider(): void {
  const providers = getRawProviders();
  const nextKey = configEditor.nextUniqueKey(providers, 'new-provider');
  sectionValue.value = { ...providers, [nextKey]: { apiType: 'openai-responses', models: {} } };
}

function removeProvider(key: string): void {
  const providers = getRawProviders();
  delete providers[key];
  clearProviderExtraBodyErrors(key);
  sectionValue.value = providers;
}

function renameProvider(oldKey: string, newKeyRaw: string): void {
  const newKey = newKeyRaw.trim();
  const providers = getRawProviders();
  if (newKey.length === 0 || newKey === oldKey) return;
  if (Object.hasOwn(providers, newKey)) {
    feedbackType.value = 'error';
    feedback.value = `A provider named "${newKey}" already exists`;
    return;
  }
  sectionValue.value = configEditor.renameRecordKey(providers, oldKey, newKey);
  renameProviderExtraBodyState(oldKey, newKey);
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
      feedbackType.value = 'error';
      feedback.value = `A model preset named "${newKey}" already exists`;
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
    if (value.trim().length > 0 && Number.isFinite(parsed)) next['contextWindow'] = parsed;
    else delete next['contextWindow'];
    return next;
  });
}

function updateProviderModelExtraBody(providerKey: string, modelKey: string, value: string): void {
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

function getExtraBodyError(providerKey: string, modelKey: string): string {
  return extraBodyErrors.value[configEditor.getExtraBodyErrorKey(providerKey, modelKey)] ?? '';
}

function getExtraBodyText(providerKey: string, modelKey: string, value: unknown): string {
  const key = configEditor.getExtraBodyErrorKey(providerKey, modelKey);
  return extraBodyDrafts.value[key] ?? configEditor.toJson(value);
}

function addMcpServer(): void {
  sectionValue.value = [...getRawMcpServers(), { name: '', transport: 'stdio', enabled: true }];
}

function removeMcpServer(index: number): void {
  updateMcpServers((servers) => servers.filter((_, itemIndex) => itemIndex !== index));
}

function updateMcpField(index: number, key: keyof McpServerForm, value: unknown): void {
  if (key === 'transport') {
    const transport = configEditor.isMcpTransport(value) ? value : 'stdio';
    updateMcpServer(index, (server) => {
      const next = { ...server, transport };
      if (transport === 'stdio') {
        delete next['url'];
      } else {
        delete next['command'];
        delete next['args'];
        delete next['env'];
      }
      return next;
    });
    return;
  }
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

function updateProvider(
  providerKey: string,
  updater: (provider: Record<string, unknown>) => Record<string, unknown>,
): void {
  const providers = getRawProviders();
  const current = providers[providerKey];
  if (!configEditor.isRecord(current)) return;
  providers[providerKey] = updater(current);
  sectionValue.value = providers;
}

function updateProviderModel(
  providerKey: string,
  modelKey: string,
  updater: (model: Record<string, unknown>) => Record<string, unknown>,
): void {
  updateProvider(providerKey, (provider) => {
    const models = configEditor.getRawModels(provider);
    const current = models[modelKey];
    if (!configEditor.isRecord(current)) return provider;
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
  sectionValue.value = updater(getRawMcpServers());
}

function getRawProviders(): Record<string, unknown> {
  if (!configEditor.isRecord(sectionValue.value)) return {};
  return Object.fromEntries(
    Object.entries(sectionValue.value).map(([key, provider]) => [
      key,
      configEditor.isRecord(provider) ? { ...provider } : {},
    ]),
  );
}

function getRawMcpServers(): Record<string, unknown>[] {
  return Array.isArray(sectionValue.value)
    ? sectionValue.value.map((item) => (configEditor.isRecord(item) ? { ...item } : {}))
    : [];
}

function setExtraBodyDraft(providerKey: string, modelKey: string, value: string): void {
  extraBodyDrafts.value = {
    ...extraBodyDrafts.value,
    [configEditor.getExtraBodyErrorKey(providerKey, modelKey)]: value,
  };
}

function setExtraBodyError(providerKey: string, modelKey: string, message: string): void {
  extraBodyErrors.value = {
    ...extraBodyErrors.value,
    [configEditor.getExtraBodyErrorKey(providerKey, modelKey)]: message,
  };
}

function clearExtraBodyError(providerKey: string, modelKey: string): void {
  const key = configEditor.getExtraBodyErrorKey(providerKey, modelKey);
  if (!Object.hasOwn(extraBodyErrors.value, key)) return;
  const next = { ...extraBodyErrors.value };
  delete next[key];
  extraBodyErrors.value = next;
}

function clearExtraBodyDraft(providerKey: string, modelKey: string): void {
  const key = configEditor.getExtraBodyErrorKey(providerKey, modelKey);
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

function renameExtraBodyState(providerKey: string, oldModelKey: string, newModelKey: string): void {
  const oldKey = configEditor.getExtraBodyErrorKey(providerKey, oldModelKey);
  const newKey = configEditor.getExtraBodyErrorKey(providerKey, newModelKey);
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

onMounted(() => {
  if (props.channelReady) void loadConfig();
});

watch(
  () => props.channelReady,
  (ready, wasReady) => {
    if (ready && !wasReady) void loadConfig();
  },
);
</script>

<style scoped>
.config-editor {
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 24px;
  margin-bottom: 24px;
  box-shadow: var(--shadow-sm);
}

.section-title {
  font-family: var(--font-heading);
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-mid-gray);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin: 0;
}

.editor-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.editor-subtitle {
  margin: 0.25rem 0 0;
  color: var(--color-mid-gray);
  font-family: var(--font-body);
  font-size: 13px;
  line-height: 1.5;
}

.editor-actions,
.entry-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.editor-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.config-entry {
  padding: 16px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: #fdfbf8;
}

.entry-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
}

.entry-header.with-margin {
  margin-bottom: 16px;
}

.entry-title {
  font-family: var(--font-heading);
  font-size: 14px;
  font-weight: 600;
  color: var(--color-dark);
}

.toggle-label {
  font-family: var(--font-heading);
  font-size: 11px;
  font-weight: 600;
  color: var(--color-dark);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.fields-title {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px dashed var(--color-border);
  font-family: var(--font-heading);
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-mid-gray);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  margin-top: 12px;
}

.field-grid.three-col {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.field-block {
  min-width: 0;
}

.field-block.full-span {
  grid-column: 1 / -1;
}

.field-block.toggle-block {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.field-label {
  display: block;
  margin-bottom: 6px;
  font-family: var(--font-heading);
  font-size: 12px;
  font-weight: 500;
  color: var(--color-dark);
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.field-input {
  width: 100%;
  padding: 9px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: #fff;
  color: var(--color-dark);
  font-family: var(--font-body);
  font-size: 14px;
  outline: none;
  transition: border var(--transition-fast);
}

.field-input:focus {
  border-color: var(--color-primary);
}

.json-input {
  min-height: 74px;
  resize: vertical;
  font-family: 'SF Mono', 'Menlo', monospace;
  font-size: 12px;
}

.save-btn,
.secondary-btn,
.danger-btn {
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-family: var(--font-heading);
  font-size: 12px;
  font-weight: 500;
  transition: all var(--transition-fast);
}

.save-btn,
.secondary-btn {
  padding: 9px 14px;
}

.save-btn {
  border: 1px solid var(--color-primary);
  background: var(--color-primary);
  color: #fff;
}

.save-btn:hover:not(:disabled) {
  background: var(--color-primary-hover);
}

.secondary-btn {
  border: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-mid-gray);
}

.secondary-btn:hover:not(:disabled) {
  color: var(--color-dark);
  border-color: var(--color-mid-gray);
}

.danger-btn {
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid transparent;
  background: #cf3a3a;
  color: #fff;
  font-size: 18px;
  line-height: 1;
}

.danger-btn:hover {
  background: #b83333;
}

.model-remove {
  align-self: end;
  margin-bottom: 1px;
}

.save-btn:disabled,
.secondary-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.status-text,
.empty-state,
.empty-inline {
  margin: 0;
  font-family: var(--font-body);
  font-size: 13px;
  line-height: 1.5;
}

.status-text.muted,
.empty-state,
.empty-inline {
  color: var(--color-mid-gray);
  font-style: italic;
}

.status-text.success {
  color: var(--color-accent-green);
}

.status-text.error {
  color: var(--color-danger);
}

.empty-state {
  padding: 24px;
  text-align: center;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-sm);
}

.empty-inline {
  margin-top: 10px;
}

.section-toolbar {
  display: flex;
  justify-content: flex-end;
}

.add-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 12px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: var(--color-primary);
  color: #fff;
  cursor: pointer;
  font-family: var(--font-heading);
  font-size: 12px;
  font-weight: 500;
  transition: all var(--transition-fast);
}

.add-btn:hover {
  background: var(--color-primary-hover);
}

.add-btn.dark {
  background: #121212;
}

.add-btn.dark:hover {
  background: #2a2a2a;
}

.pill {
  display: inline-flex;
  align-items: center;
  padding: 0.2rem 0.65rem;
  border-radius: 999px;
  background: rgba(176, 174, 165, 0.2);
  color: #8a8880;
  font-family: var(--font-heading);
  font-size: 0.7rem;
  font-weight: 500;
  letter-spacing: 0.03em;
}

.pill.enabled {
  background: rgba(120, 140, 93, 0.12);
  color: #5a6e47;
}

.subsection-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px dashed var(--color-border);
}

.subsection-title {
  font-family: var(--font-heading);
  font-size: 14px;
  font-weight: 600;
  color: var(--color-dark);
}

.nested-entry {
  margin-top: 12px;
  padding: 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: rgba(250, 249, 245, 0.75);
}

.empty-state.compact {
  padding: 18px;
  margin-top: 12px;
}

.field-error {
  margin-top: 6px;
}

@media (max-width: 820px) {
  .editor-header,
  .entry-header {
    flex-direction: column;
    align-items: stretch;
  }

  .field-grid {
    grid-template-columns: 1fr;
  }
}
</style>
