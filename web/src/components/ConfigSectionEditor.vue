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
        <button class="btn btn-ghost" @click="exportSection">Export</button>
      </div>
    </div>

    <div v-if="loading" class="empty-state">Loading {{ title.toLowerCase() }} configuration...</div>
    <div v-else-if="error" class="form-error">{{ error }}</div>
    <div v-else class="section-content">
      <section class="section-editor">
        <div class="section-editor-header">
          <div>
            <h2 class="section-title">{{ editorTitle }}</h2>
            <p class="section-subtitle">{{ editorSubtitle }}</p>
          </div>

          <button type="button" class="btn btn-primary btn-sm" @click="addEntry">
            + Add {{ entryNoun }}
          </button>
        </div>

        <div v-if="itemCount === 0" class="empty-state section-empty">
          No {{ title.toLowerCase() }} configuration entries.
        </div>

        <template v-if="sectionKey === 'channels'">
          <div v-for="entry in channelEntries" :key="entry.key" class="config-entry">
            <div class="config-entry-header">
              <div>
                <div class="config-entry-title">{{ entry.key || 'New channel' }}</div>
                <span class="badge badge-gray">Channel</span>
              </div>
              <button type="button" class="btn btn-danger btn-sm" @click="removeChannel(entry.key)">
                Remove
              </button>
            </div>

            <div class="entry-fields">
              <div class="form-group">
                <label class="field-label">Key</label>
                <input
                  :value="entry.key"
                  class="form-input"
                  placeholder="onebot"
                  @change="renameChannel(entry.key, ($event.target as HTMLInputElement).value)"
                />
              </div>

              <div class="form-group entry-wide">
                <label class="field-label">Configuration JSON</label>
                <JsonEditor
                  :model-value="toJson(entry.value)"
                  placeholder="{}"
                  @update:model-value="updateChannelJson(entry.key, $event)"
                />
              </div>
            </div>
          </div>
        </template>

        <template v-else>
          <div v-for="(plugin, index) in pluginEntries" :key="index" class="config-entry">
            <div class="config-entry-header">
              <div>
                <div class="config-entry-title">{{ plugin.name || `Plugin ${index + 1}` }}</div>
                <span class="badge" :class="plugin.enabled ? 'badge-green' : 'badge-gray'">
                  {{ plugin.enabled ? 'Enabled' : 'Disabled' }}
                </span>
              </div>
              <button type="button" class="btn btn-danger btn-sm" @click="removePlugin(index)">
                Remove
              </button>
            </div>

            <div class="entry-fields">
              <div class="form-group">
                <label class="field-label">Name</label>
                <input
                  :value="plugin.name"
                  class="form-input"
                  placeholder="plugin-name"
                  @input="updatePluginField(index, 'name', ($event.target as HTMLInputElement).value)"
                />
              </div>

              <label class="field-label entry-toggle">
                <input
                  :checked="plugin.enabled"
                  type="checkbox"
                  @change="updatePluginField(index, 'enabled', ($event.target as HTMLInputElement).checked)"
                />
                Enabled
              </label>

              <div class="form-group entry-wide">
                <label class="field-label">Options JSON</label>
                <JsonEditor
                  :model-value="toJson(plugin.options ?? {})"
                  placeholder="{}"
                  @update:model-value="updatePluginOptions(index, $event)"
                />
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
  editorTitle: string;
  editorSubtitle: string;
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

function exportSection() {
  const blob = new Blob([JSON.stringify(sectionValue.value, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `aesyclaw-${props.sectionKey}.json`;
  a.click();
  URL.revokeObjectURL(url);
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

function updateChannelJson(key: string, value: string) {
  const parsed = parseJson(value);
  if (parsed === undefined || !isRecord(sectionValue.value)) return;
  sectionValue.value = { ...sectionValue.value, [key]: parsed };
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
  margin-bottom: 1rem;
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

:deep(.json-editor) {
  min-height: 120px;
}

@media (max-width: 900px) {
  .section-page-header,
  .section-editor-header,
  .config-entry-header,
  .entry-fields {
    display: flex;
    flex-direction: column;
  }

  .section-toolbar {
    width: 100%;
  }

  .entry-toggle {
    align-self: flex-start;
  }
}
</style>
