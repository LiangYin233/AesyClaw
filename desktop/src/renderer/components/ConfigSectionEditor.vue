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
          :disabled="!adminReady || saving || Boolean(sectionJsonError)"
          @click="saveSection"
        >
          {{ saving ? 'Saving…' : 'Save' }}
        </button>
        <button class="secondary-btn" :disabled="!adminReady || loading" @click="loadConfig">
          Reset
        </button>
      </div>
    </div>

    <p v-if="!adminReady" class="status-text muted">
      Waiting for the Desktop admin connection before loading configuration.
    </p>
    <p v-else-if="loading" class="status-text muted">
      Loading {{ title.toLowerCase() }} configuration…
    </p>
    <p v-else-if="error" class="status-text error">{{ error }}</p>
    <p v-else-if="feedback" class="status-text" :class="feedbackType">{{ feedback }}</p>

    <div v-if="adminReady && !loading && !error" class="editor-body">
      <div v-if="itemCount === 0" class="empty-state">
        No {{ entryNoun }} configuration entries.
      </div>

      <template v-if="sectionKey === 'channels'">
        <article v-for="entry in channelEntries" :key="entry.key" class="config-entry">
          <div class="entry-header">
            <div class="entry-title">{{ entry.key || 'New channel' }}</div>
            <div class="entry-controls">
              <label class="toggle-label">Enabled</label>
              <ToggleSwitch
                :model-value="getChannelEnabled(entry)"
                :disabled="saving"
                @update:model-value="toggleChannelEnabled(entry.key)"
              />
              <button
                class="danger-btn"
                type="button"
                title="Remove channel"
                @click="removeChannel(entry.key)"
              >
                ×
              </button>
            </div>
          </div>

          <div class="fields-title">Configuration</div>
          <div v-if="getChannelFields(entry).length === 0" class="empty-inline">
            No editable fields.
          </div>
          <div v-else class="field-grid">
            <div
              v-for="field in getChannelFields(entry)"
              :key="`${entry.key}-${field.key}`"
              class="field-block"
            >
              <label class="field-label">{{ field.displayLabel }}</label>
              <ToggleSwitch
                v-if="field.type === 'boolean'"
                :model-value="Boolean(field.value)"
                @update:model-value="setChannelField(entry.key, field.path, $event)"
              />
              <input
                v-else-if="field.type === 'number'"
                :value="field.value"
                type="number"
                class="field-input"
                @input="
                  setChannelField(
                    entry.key,
                    field.path,
                    parseFloat(($event.target as HTMLInputElement).value) || 0,
                  )
                "
              />
              <textarea
                v-else-if="field.type === 'object'"
                :value="toJson(field.value)"
                class="field-input json-input"
                rows="3"
                @input="
                  handleChannelComplexField(
                    entry.key,
                    field.path,
                    ($event.target as HTMLTextAreaElement).value,
                  )
                "
              />
              <input
                v-else
                :value="field.value"
                class="field-input"
                @input="
                  setChannelField(entry.key, field.path, ($event.target as HTMLInputElement).value)
                "
              />
            </div>
          </div>
        </article>
      </template>

      <template v-else-if="sectionKey === 'plugins'">
        <article
          v-for="(plugin, index) in pluginEntries"
          :key="`${plugin.name}-${index}`"
          class="config-entry"
        >
          <div class="entry-header">
            <div class="entry-title">{{ plugin.name || `Plugin ${index + 1}` }}</div>
            <div class="entry-controls">
              <label class="toggle-label">Enabled</label>
              <ToggleSwitch
                :model-value="plugin.enabled"
                :disabled="saving"
                @update:model-value="updatePluginField(index, 'enabled', $event)"
              />
              <button
                class="danger-btn"
                type="button"
                title="Remove plugin"
                @click="removePlugin(index)"
              >
                ×
              </button>
            </div>
          </div>

          <div class="fields-title">Options</div>
          <div v-if="getPluginFields(plugin).length === 0" class="empty-inline">No options.</div>
          <div v-else class="field-grid">
            <div
              v-for="field in getPluginFields(plugin)"
              :key="`plugin-${index}-${field.key}`"
              class="field-block"
            >
              <label class="field-label">{{ field.displayLabel }}</label>
              <ToggleSwitch
                v-if="field.type === 'boolean'"
                :model-value="Boolean(field.value)"
                @update:model-value="setPluginOptionField(index, field.path, $event)"
              />
              <input
                v-else-if="field.type === 'number'"
                :value="field.value"
                type="number"
                class="field-input"
                @input="
                  setPluginOptionField(
                    index,
                    field.path,
                    parseFloat(($event.target as HTMLInputElement).value) || 0,
                  )
                "
              />
              <textarea
                v-else-if="field.type === 'object'"
                :value="toJson(field.value)"
                class="field-input json-input"
                rows="3"
                @input="
                  handlePluginComplexField(
                    index,
                    field.path,
                    ($event.target as HTMLTextAreaElement).value,
                  )
                "
              />
              <input
                v-else
                :value="field.value"
                class="field-input"
                @input="
                  setPluginOptionField(index, field.path, ($event.target as HTMLInputElement).value)
                "
              />
            </div>
          </div>
        </article>
      </template>

      <template v-else>
        <article class="config-entry">
          <div class="fields-title generic-title">JSON</div>
          <textarea
            v-model="sectionJsonDraft"
            class="field-input json-input section-json-input"
            rows="10"
            @input="handleGenericSection(sectionJsonDraft)"
          />
          <p v-if="sectionJsonError" class="status-text error section-json-error">
            {{ sectionJsonError }}
          </p>
          <p v-else class="empty-inline">
            Edit this section as JSON. It will be saved through the same update_config protocol used by WebUI.
          </p>
        </article>
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import ToggleSwitch from './ToggleSwitch.vue';

interface PluginEntry extends Record<string, unknown> {
  name: string;
  enabled: boolean;
  options?: Record<string, unknown>;
}

interface ChannelEntry {
  key: string;
  value: unknown;
}

interface ConfigField {
  path: string;
  key: string;
  displayLabel: string;
  value: unknown;
  type: 'string' | 'number' | 'boolean' | 'object';
}

type ConfigSectionKey = 'channels' | 'plugins' | 'server' | 'providers' | 'agent' | 'mcp';

const props = defineProps<{
  sectionKey: ConfigSectionKey;
  title: string;
  subtitle: string;
  adminReady: boolean;
}>();

const sectionValue = ref<unknown>(getDefaultSectionValue(props.sectionKey));
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const feedback = ref('');
const feedbackType = ref<'success' | 'error'>('success');
const sectionJsonError = ref('');
const sectionJsonDraft = ref(toJson(sectionValue.value));

const sectionKey = computed(() => props.sectionKey);
const entryNoun = computed(() => {
  if (props.sectionKey === 'plugins') return 'plugin';
  if (props.sectionKey === 'channels') return 'channel';
  return 'section';
});

const itemCount = computed(() => {
  if (props.sectionKey !== 'channels' && props.sectionKey !== 'plugins') return 1;
  if (Array.isArray(sectionValue.value)) return sectionValue.value.length;
  if (isRecord(sectionValue.value)) return Object.keys(sectionValue.value).length;
  return 0;
});

const channelEntries = computed<ChannelEntry[]>(() => {
  if (!isRecord(sectionValue.value)) return [];
  return Object.entries(sectionValue.value).map(([key, value]) => ({ key, value }));
});

const pluginEntries = computed<PluginEntry[]>(() => {
  if (!Array.isArray(sectionValue.value)) return [];
  return sectionValue.value.map(normalizePluginEntry);
});

async function loadConfig(): Promise<void> {
  if (!props.adminReady) return;
  loading.value = true;
  error.value = '';
  feedback.value = '';
  sectionJsonError.value = '';
  try {
    const config = await requestAdmin<Record<string, unknown>>('get_config');
    sectionValue.value = getSectionValue(config, props.sectionKey);
    sectionJsonDraft.value = toJson(sectionValue.value);
  } catch (err) {
    error.value = err instanceof Error ? err.message : `Failed to load ${props.sectionKey} config`;
  } finally {
    loading.value = false;
  }
}

async function saveSection(): Promise<void> {
  if (!props.adminReady) return;
  if (sectionJsonError.value) return;
  saving.value = true;
  error.value = '';
  feedback.value = '';
  try {
    await requestAdmin('update_config', { [props.sectionKey]: sectionValue.value });
    feedbackType.value = 'success';
    feedback.value = `${props.title} configuration saved`;
  } catch (err) {
    feedbackType.value = 'error';
    feedback.value = err instanceof Error ? err.message : 'Save failed';
  } finally {
    saving.value = false;
  }
}

async function requestAdmin<T = unknown>(type: string, payload?: unknown): Promise<T> {
  const response = await window.aesyclaw.adminRequest(type, payload);
  if (!response.ok) {
    throw new Error(response.error ?? `${type} failed`);
  }
  return response.data as T;
}

function removeChannel(key: string): void {
  if (!isRecord(sectionValue.value)) return;
  const next = { ...sectionValue.value };
  delete next[key];
  sectionValue.value = next;
}

function getChannelEnabled(entry: ChannelEntry): boolean {
  return isRecord(entry.value) && typeof entry.value['enabled'] === 'boolean'
    ? entry.value['enabled']
    : true;
}

async function toggleChannelEnabled(key: string): Promise<void> {
  const current = isRecord(sectionValue.value) ? sectionValue.value : {};
  const channelValue = isRecord(current[key]) ? current[key] : {};
  const enabled = channelValue['enabled'] === false;
  sectionValue.value = { ...current, [key]: { ...channelValue, enabled } };

  try {
    await requestAdmin('set_channel_enabled', { name: key, enabled });
    feedbackType.value = 'success';
    feedback.value = `${key} ${enabled ? 'enabled' : 'disabled'}`;
  } catch (err) {
    sectionValue.value = current;
    feedbackType.value = 'error';
    feedback.value = err instanceof Error ? err.message : 'Failed to update channel';
  }
}

function getChannelFields(entry: ChannelEntry): ConfigField[] {
  return isRecord(entry.value) ? getFields(entry.value, ['enabled']) : [];
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
    fields.push({ path: key, key, displayLabel: formatFieldLabel(key), value: val, type });
  }
  return fields;
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

function setChannelField(channelKey: string, path: string, value: unknown): void {
  const current = isRecord(sectionValue.value) ? sectionValue.value : {};
  const channelConfig = isRecord(current[channelKey]) ? { ...current[channelKey] } : {};
  setNestedValue(channelConfig, path, value);
  sectionValue.value = { ...current, [channelKey]: channelConfig };
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!part) continue;
    if (!isRecord(current[part])) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  const lastPart = parts[parts.length - 1];
  if (lastPart) current[lastPart] = value;
}

function handleChannelComplexField(channelKey: string, path: string, raw: string): void {
  handleComplexField(raw, (parsed) => setChannelField(channelKey, path, parsed));
}

function removePlugin(index: number): void {
  const next = [...getRawPlugins()];
  next.splice(index, 1);
  sectionValue.value = next;
}

async function updatePluginField(
  index: number,
  key: 'name' | 'enabled',
  value: string | boolean,
): Promise<void> {
  const previous = [...getRawPlugins()];
  const next = [...previous];
  const current = next[index];
  if (!current) return;
  next[index] = { ...current, [key]: value };
  sectionValue.value = next;

  if (key !== 'enabled') return;
  const name = typeof current['name'] === 'string' ? current['name'] : '';
  if (!name) return;

  try {
    await requestAdmin('set_plugin_enabled', { name, enabled: value });
    feedbackType.value = 'success';
    feedback.value = `${name} ${value ? 'enabled' : 'disabled'}`;
  } catch (err) {
    sectionValue.value = previous;
    feedbackType.value = 'error';
    feedback.value = err instanceof Error ? err.message : 'Failed to update plugin';
  }
}

function getPluginFields(plugin: PluginEntry): ConfigField[] {
  const options = isRecord(plugin['options']) ? plugin['options'] : {};
  return getFields(options);
}

function setPluginOptionField(index: number, path: string, value: unknown): void {
  const next = [...getRawPlugins()];
  const current = next[index];
  if (!current) return;
  const options = isRecord(current['options']) ? { ...current['options'] } : {};
  setNestedValue(options, path, value);
  next[index] = { ...current, options };
  sectionValue.value = next;
}

function handlePluginComplexField(index: number, path: string, raw: string): void {
  handleComplexField(raw, (parsed) => setPluginOptionField(index, path, parsed));
}

function handleComplexField(raw: string, setParsed: (value: unknown) => void): void {
  try {
    setParsed(JSON.parse(raw) as unknown);
  } catch {
    // Match WebUI behavior: leave the last valid value intact while the user edits invalid JSON.
  }
}

function handleGenericSection(raw: string): void {
  try {
    sectionValue.value = JSON.parse(raw) as unknown;
    sectionJsonError.value = '';
  } catch (err) {
    sectionJsonError.value = err instanceof Error ? err.message : 'Invalid JSON';
  }
}

function getSectionValue(source: unknown, key: ConfigSectionKey): unknown {
  if (!isRecord(source)) return getDefaultSectionValue(key);
  const value = source[key];
  if (value === undefined) return getDefaultSectionValue(key);
  if (key === 'plugins') return Array.isArray(value) ? value : [];
  if (key === 'mcp') return Array.isArray(value) ? value : [];
  if (key === 'channels') return isRecord(value) ? value : {};
  return value;
}

function getDefaultSectionValue(key: ConfigSectionKey): unknown {
  if (key === 'plugins' || key === 'mcp') return [];
  return {};
}

function normalizePluginEntry(value: unknown): PluginEntry {
  const source = isRecord(value) ? value : {};
  return {
    ...source,
    name: typeof source['name'] === 'string' ? source['name'] : '',
    enabled: typeof source['enabled'] === 'boolean' ? source['enabled'] : true,
    options: isRecord(source['options']) ? source['options'] : undefined,
  };
}

function getRawPlugins(): Record<string, unknown>[] {
  if (!Array.isArray(sectionValue.value)) return [];
  return sectionValue.value.map((item) => (isRecord(item) ? { ...item } : {}));
}

function formatFieldLabel(key: string): string {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

onMounted(() => {
  if (props.adminReady) void loadConfig();
});

watch(
  () => props.adminReady,
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

.field-block {
  min-width: 0;
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
