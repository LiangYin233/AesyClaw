<template>
  <div>
    <div class="section-page-header">
      <div>
        <h1 class="page-title">{{ title }}</h1>
        <p class="page-subtitle">{{ subtitle }}</p>
      </div>
      <div class="toolbar section-toolbar">
        <button class="btn btn-success" :disabled="saving" @click="saveSection">
          {{ saving ? 'Saving...' : 'Save' }}
        </button>
        <button class="btn btn-ghost" @click="loadConfig">Reset</button>
      </div>
    </div>

    <div v-if="loading" class="empty-state">Loading {{ title.toLowerCase() }} configuration...</div>
    <div v-else-if="error" class="form-error">{{ error }}</div>
    <div v-else class="section-content">
      <section class="section-editor">
        <div class="section-editor-header">
          </div>

        <div v-if="itemCount === 0" class="empty-state section-empty">
          No {{ title.toLowerCase() }} configuration entries.
        </div>

        <template v-if="sectionKey === 'channels'">
          <div v-for="entry in channelEntries" :key="entry.key" class="config-entry">
            <div class="config-entry-header">
              <div>
                <div class="config-entry-title">{{ entry.key || 'New channel' }}</div>
              </div>
              <div class="header-actions">
                <div class="header-toggle">
                  <label class="field-label">Enabled</label>
                  <button
                    type="button"
                    class="toggle-switch"
                    :class="{ active: getChannelEnabled(entry) }"
                    @click="toggleChannelEnabled(entry.key)"
                  >
                    <span class="toggle-thumb"></span>
                  </button>
                </div>
                <button type="button" class="btn btn-danger btn-sm" @click="removeChannel(entry.key)">
                  Remove
                </button>
              </div>
            </div>

            <div class="entry-fields">
              <div class="config-section entry-wide">
                <div class="config-section-label">Configuration</div>
                <div class="config-fields">
                  <template v-for="field in getChannelFields(entry)" :key="`${entry.key}-${field.key}`">
                    <div class="form-group config-field">
                      <label class="field-label">{{ field.displayLabel }}</label>
                      <template v-if="field.type === 'boolean'">
                        <button
                          type="button"
                          class="toggle-switch"
                          :class="{ active: field.value }"
                          @click="setChannelField(entry.key, field.path, !field.value)"
                        >
                          <span class="toggle-thumb"></span>
                        </button>
                      </template>
                      <input
                        v-else-if="field.type === 'number'"
                        :value="field.value"
                        type="number"
                        class="form-input"
                        @input="setChannelField(entry.key, field.path, parseFloat(($event.target as HTMLInputElement).value) || 0)"
                      />
                      <textarea
                        v-else-if="field.type === 'object'"
                        :value="toJson(field.value)"
                        class="form-input form-textarea form-textarea-sm"
                        rows="3"
                        @input="handleChannelComplexField(entry.key, field.path, ($event.target as HTMLTextAreaElement).value)"
                      />
                      <input
                        v-else
                        :value="field.value"
                        class="form-input"
                        @input="setChannelField(entry.key, field.path, ($event.target as HTMLInputElement).value)"
                      />
                    </div>
                  </template>
                </div>
              </div>
            </div>
          </div>
        </template>

        <template v-else>
          <div v-for="(plugin, index) in pluginEntries" :key="index" class="config-entry">
            <div class="config-entry-header">
              <div>
                <div class="config-entry-title">{{ plugin.name || `Plugin ${index + 1}` }}</div>
              </div>
              <div class="header-actions">
                <div class="header-toggle">
                  <label class="field-label">Enabled</label>
                  <button
                    type="button"
                    class="toggle-switch"
                    :class="{ active: plugin.enabled }"
                    @click="updatePluginField(index, 'enabled', !plugin.enabled)"
                  >
                    <span class="toggle-thumb"></span>
                  </button>
                </div>
                <button type="button" class="btn btn-danger btn-sm" @click="removePlugin(index)">
                  Remove
                </button>
              </div>
            </div>

            <div class="entry-fields">
              <div v-if="getPluginFields(plugin).length > 0" class="config-section entry-wide">
                <div class="config-section-label">Options</div>
                <div class="config-fields">
                  <template v-for="field in getPluginFields(plugin)" :key="`plugin-${index}-${field.key}`">
                    <div class="form-group config-field">
                      <label class="field-label">{{ field.displayLabel }}</label>
                      <template v-if="field.type === 'boolean'">
                        <button
                          type="button"
                          class="toggle-switch"
                          :class="{ active: field.value }"
                          @click="setPluginOptionField(index, field.path, !field.value)"
                        >
                          <span class="toggle-thumb"></span>
                        </button>
                      </template>
                      <input
                        v-else-if="field.type === 'number'"
                        :value="field.value"
                        type="number"
                        class="form-input"
                        @input="setPluginOptionField(index, field.path, parseFloat(($event.target as HTMLInputElement).value) || 0)"
                      />
                      <textarea
                        v-else-if="field.type === 'object'"
                        :value="toJson(field.value)"
                        class="form-input form-textarea form-textarea-sm"
                        rows="3"
                        @input="handlePluginComplexField(index, field.path, ($event.target as HTMLTextAreaElement).value)"
                      />
                      <input
                        v-else
                        :value="field.value"
                        class="form-input"
                        @input="setPluginOptionField(index, field.path, ($event.target as HTMLInputElement).value)"
                      />
                    </div>
                  </template>
                </div>
              </div>
            </div>
          </div>
        </template>
      </section>
    </div>

    <div v-if="toast" class="toast" :class="toast.type">{{ toast.message }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useAuth } from '@/composables/useAuth';
import JsonEditor from '@/components/JsonEditor.vue';

interface PluginEntry extends Record<string, unknown> {
  name: string;
  enabled: boolean;
  options?: Record<string, unknown>;
}

interface ChannelEntry {
  key: string;
  value: unknown;
}

const props = defineProps<{
  sectionKey: 'channels' | 'plugins';
  title: string;
  subtitle: string;

}>();

const { api } = useAuth();

const fullConfig = ref<Record<string, unknown>>({});
const sectionValue = ref<unknown>(props.sectionKey === 'plugins' ? [] : {});
const loading = ref(true);
const saving = ref(false);
const error = ref('');
const toast = ref<{ type: string; message: string } | null>(null);
const sectionKey = computed(() => props.sectionKey);
const entryNoun = computed(() => (props.sectionKey === 'plugins' ? 'plugin' : 'channel'));

const itemCount = computed(() => {
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

function showToast(type: string, message: string) {
  toast.value = { type, message };
  setTimeout(() => {
    toast.value = null;
  }, 3000);
}

async function loadConfig() {
  loading.value = true;
  error.value = '';
  try {
    const res = await api.get('/config');
    if (res.data.ok) {
      fullConfig.value = res.data.data;
      sectionValue.value = getSectionValue(res.data.data, props.sectionKey);
    } else {
      error.value = res.data.error ?? `Failed to load ${props.sectionKey} config`;
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : `Failed to load ${props.sectionKey} config`;
  } finally {
    loading.value = false;
  }
}

async function saveSection() {
  saving.value = true;
  try {
    const payload = { [props.sectionKey]: sectionValue.value };
    const res = await api.put('/config', payload);
    if (res.data.ok) {
      fullConfig.value = { ...fullConfig.value, [props.sectionKey]: sectionValue.value };
      showToast('toast-success', `${props.title} configuration saved`);
    } else {
      showToast('toast-error', res.data.error ?? 'Save failed');
    }
  } catch (err) {
    showToast('toast-error', err instanceof Error ? err.message : 'Save failed');
  } finally {
    saving.value = false;
  }
}

function addEntry() {
  if (props.sectionKey === 'plugins') {
    sectionValue.value = [...pluginEntries.value, { name: '', enabled: true, options: {} }];
    return;
  }

  const current = isRecord(sectionValue.value) ? sectionValue.value : {};
  let nextKey = 'new-channel';
  let suffix = 1;
  while (Object.prototype.hasOwnProperty.call(current, nextKey)) {
    suffix += 1;
    nextKey = `new-channel-${suffix}`;
  }
  sectionValue.value = { ...current, [nextKey]: {} };
}

function renameChannel(oldKey: string, newKeyRaw: string) {
  const newKey = newKeyRaw.trim();
  if (!newKey || newKey === oldKey || !isRecord(sectionValue.value)) return;
  if (Object.prototype.hasOwnProperty.call(sectionValue.value, newKey)) {
    showToast('toast-error', `A channel named "${newKey}" already exists`);
    return;
  }
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(sectionValue.value)) {
    if (key === oldKey) {
      next[newKey] = value;
    } else {
      next[key] = value;
    }
  }
  sectionValue.value = next;
}

function removeChannel(key: string) {
  if (!isRecord(sectionValue.value)) return;
  const next = { ...sectionValue.value };
  delete next[key];
  sectionValue.value = next;
}

function getChannelEnabled(entry: ChannelEntry): boolean {
  return isRecord(entry.value) && typeof entry.value.enabled === 'boolean' ? entry.value.enabled : true;
}

function toggleChannelEnabled(key: string) {
  const current = isRecord(sectionValue.value) ? sectionValue.value : {};
  const channelValue = isRecord(current[key]) ? current[key] : {};
  const enabled = channelValue.enabled === false;
  sectionValue.value = { ...current, [key]: { ...channelValue, enabled } };
}

interface ChannelField {
  path: string;
  key: string;
  displayLabel: string;
  value: unknown;
  type: 'string' | 'number' | 'boolean' | 'object';
}

function getChannelFields(entry: ChannelEntry): ChannelField[] {
  const fields: ChannelField[] = [];
  if (!isRecord(entry.value)) return fields;

  const flat = flattenObject(entry.value);
  for (const [key, val] of Object.entries(flat)) {
    if (key === 'enabled') continue;
    let type: ChannelField['type'] = 'string';
    if (typeof val === 'number') type = 'number';
    else if (typeof val === 'boolean') type = 'boolean';
    else if (typeof val === 'object' && val !== null) type = 'object';
    fields.push({
      path: key,
      key,
      displayLabel: formatFieldLabel(key),
      value: val,
      type,
    });
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

function setChannelField(channelKey: string, path: string, value: unknown) {
  const current = isRecord(sectionValue.value) ? sectionValue.value : {};
  const channelConfig = isRecord(current[channelKey]) ? { ...current[channelKey] } : {};
  setNestedValue(channelConfig, path, value);
  sectionValue.value = { ...current, [channelKey]: channelConfig };
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!isRecord(current[parts[i]])) {
      current[parts[i]] = {};
    }
    current = current[parts[i]] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

function handleChannelComplexField(channelKey: string, path: string, raw: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  setChannelField(channelKey, path, parsed);
}

function formatFieldLabel(key: string): string {
  const parts = key.split('.');
  return parts
    .map((p) =>
      p
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase()),
    )
    .join(' > ');
}

function removePlugin(index: number) {
  const next = [...getRawPlugins()];
  next.splice(index, 1);
  sectionValue.value = next;
}

function updatePluginField(index: number, key: 'name' | 'enabled', value: string | boolean) {
  const next = [...getRawPlugins()];
  const current = next[index];
  if (!current) return;
  next[index] = { ...current, [key]: value };
  sectionValue.value = next;
}

function updatePluginOptions(index: number, value: string) {
  const parsed = parseJson(value);
  if (parsed === undefined) return;
  const next = [...getRawPlugins()];
  const current = next[index];
  if (!current) return;
  next[index] = { ...current, options: isRecord(parsed) ? parsed : {} };
  sectionValue.value = next;
}

function getPluginFields(plugin: PluginEntry): ChannelField[] {
  const fields: ChannelField[] = [];
  const options = isRecord(plugin.options) ? plugin.options : {};

  const flat = flattenObject(options);
  for (const [key, val] of Object.entries(flat)) {
    let type: ChannelField['type'] = 'string';
    if (typeof val === 'number') type = 'number';
    else if (typeof val === 'boolean') type = 'boolean';
    else if (typeof val === 'object' && val !== null) type = 'object';
    fields.push({
      path: key,
      key,
      displayLabel: formatFieldLabel(key),
      value: val,
      type,
    });
  }
  return fields;
}

function setPluginOptionField(index: number, path: string, value: unknown) {
  const next = [...getRawPlugins()];
  const current = next[index];
  if (!current) return;
  const options = isRecord(current.options) ? { ...current.options } : {};
  setNestedValue(options, path, value);
  next[index] = { ...current, options };
  sectionValue.value = next;
}

function handlePluginComplexField(index: number, path: string, raw: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  setPluginOptionField(index, path, parsed);
}

function getSectionValue(source: unknown, key: 'channels' | 'plugins'): unknown {
  if (!isRecord(source)) return key === 'plugins' ? [] : {};
  const value = source[key];
  if (key === 'plugins') return Array.isArray(value) ? value : [];
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizePluginEntry(value: unknown): PluginEntry {
  const source = isRecord(value) ? value : {};
  return {
    ...source,
    name: typeof source.name === 'string' ? source.name : '',
    enabled: typeof source.enabled === 'boolean' ? source.enabled : true,
    options: isRecord(source.options) ? source.options : undefined,
  };
}

function getRawPlugins(): Record<string, unknown>[] {
  if (!Array.isArray(sectionValue.value)) return [];
  return sectionValue.value.map((item) => (isRecord(item) ? { ...item } : {}));
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

onMounted(() => {
  void loadConfig();
});
</script>

<style scoped>
.section-page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.page-subtitle,
.section-subtitle {
  font-family: var(--font-body);
  color: var(--color-text-muted);
}

.page-subtitle {
  font-size: 0.9rem;
  margin: 0.25rem 0 0;
}

.section-toolbar {
  margin-bottom: 0;
  justify-content: flex-end;
}

.section-content,
.section-editor {
  min-width: 0;
}

.section-editor {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.section-editor-header,
.config-entry-header {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
}

.section-editor-header {
  align-items: flex-start;
}

.section-title,
.config-entry-title {
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
  font-size: 0.82rem;
}

.config-entry {
  padding: 1rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  background: #FCFAF7;
  box-shadow: var(--shadow-sm);
}

.config-entry-header {
  align-items: center;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.header-toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.header-toggle .field-label {
  margin: 0;
  font-size: 0.82rem;
  white-space: nowrap;
}

.config-entry-title {
  margin-bottom: 0.35rem;
  font-size: 0.95rem;
  font-weight: 600;
}

.entry-fields {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
}

.entry-wide {
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

.entry-toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  align-self: end;
  min-height: 2.45rem;
  margin-bottom: 1.25rem;
  cursor: pointer;
}

.section-empty {
  border: 1px dashed var(--color-border);
  border-radius: var(--radius);
}

.form-textarea-sm {
  min-height: 60px;
  font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  font-size: 0.78rem;
}

.config-section {
  margin-top: 0.25rem;
  padding-top: 0.75rem;
}

.config-section-label {
  font-family: var(--font-heading);
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 0.75rem;
}

.config-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}

:deep(.json-editor) {
  min-height: 120px;
}

@media (max-width: 900px) {
  .section-page-header,
  .section-editor-header,
  .config-entry-header,
  .entry-fields,
  .config-fields {
    display: flex;
    flex-direction: column;
  }

  .section-toolbar {
    width: 100%;
  }
}
</style>
