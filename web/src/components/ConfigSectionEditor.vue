<template>
  <div>
    <div class="flex items-start justify-between gap-4 mb-6">
      <div>
        <h1 class="page-title">{{ title }}</h1>
        <p class="page-subtitle" style="margin: 0.25rem 0 0">{{ subtitle }}</p>
      </div>
      <div class="flex items-center gap-2.5 mb-0 justify-end">
        <button
          class="inline-flex items-center justify-center gap-1.5 px-[1.1rem] py-[0.55rem] border border-primary rounded-sm font-heading text-xs font-medium cursor-pointer transition-all duration-[0.15s] ease tracking-[0.01em] uppercase bg-primary text-white hover:bg-primary-hover hover:-translate-y-[1px] hover:shadow-[0_4px_12px_rgba(217,119,87,0.25)] disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none"
          :disabled="saving"
          @click="saveSection"
        >
          {{ saving ? 'Saving...' : 'Save' }}
        </button>
        <button
          class="inline-flex items-center justify-center gap-1.5 px-[1.1rem] py-[0.55rem] border border-[var(--color-border)] rounded-sm font-heading text-xs font-medium cursor-pointer transition-all duration-[0.15s] ease tracking-[0.01em] uppercase bg-transparent text-mid-gray hover:bg-light-gray hover:text-dark hover:border-mid-gray"
          @click="loadConfig"
        >
          Reset
        </button>
      </div>
    </div>

    <div v-if="loading" class="text-mid-gray text-center py-10 font-body italic text-sm">
      Loading {{ title.toLowerCase() }} configuration...
    </div>
    <div v-else-if="error" class="text-danger text-sm mt-3 font-body">{{ error }}</div>
    <div v-else class="min-w-0">
      <section class="flex flex-col gap-4 min-w-0">
        <div
          v-if="itemCount === 0"
          class="text-mid-gray text-center py-10 font-body italic text-sm border border-dashed border-[var(--color-border)] rounded"
        >
          No {{ title.toLowerCase() }} configuration entries.
        </div>

        <template v-if="sectionKey === 'channels'">
          <div
            v-for="entry in channelEntries"
            :key="entry.key"
            class="p-4 border border-[var(--color-border)] rounded bg-surface shadow-sm"
          >
            <div class="flex items-center justify-between gap-4 mb-0">
              <div>
                <div class="font-heading text-sm font-semibold text-dark mb-[0.35rem]">
                  {{ entry.key || 'New channel' }}
                </div>
              </div>
              <div class="flex items-center gap-2.5 mb-0">
                <div class="flex items-center gap-2.5 mb-0">
                  <label
                    class="font-heading text-xs font-medium text-dark tracking-[0.02em] uppercase whitespace-nowrap m-0"
                    >Enabled</label
                  >
                  <button
                    type="button"
                    class="w-11 h-6 rounded-full border-none cursor-pointer relative transition-colors duration-[0.15s] ease p-0"
                    :class="getChannelEnabled(entry) ? 'bg-accent-green' : 'bg-mid-gray'"
                    @click="toggleChannelEnabled(entry.key)"
                  >
                    <span
                      class="absolute top-[2px] left-[2px] w-5 h-5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.15)] transition-transform duration-[0.15s] ease"
                      :class="{ 'translate-x-5': getChannelEnabled(entry) }"
                    ></span>
                  </button>
                </div>
                <button
                  type="button"
                  class="inline-flex items-center justify-center p-1.5 border border-transparent rounded-sm cursor-pointer transition-all duration-[0.15s] ease bg-[#CF3A3A] text-white hover:bg-[#b83333] disabled:opacity-50 disabled:cursor-not-allowed"
                  @click="removeChannel(entry.key)"
                >
                  <TrashIcon class="w-4 h-4" />
                </button>
              </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-0">
              <div class="col-span-1 md:col-span-2 lg:col-span-3 mt-1 pt-3">
                <div
                  class="font-heading text-[0.7rem] font-semibold text-mid-gray uppercase tracking-[0.08em] mb-3"
                >
                  Configuration
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <template
                    v-for="field in getChannelFields(entry)"
                    :key="`${entry.key}-${field.key}`"
                  >
                    <div class="mb-5">
                      <label
                        class="block mb-[0.4rem] font-heading font-medium text-xs text-dark tracking-[0.02em] uppercase"
                        >{{ field.displayLabel }}</label
                      >
                      <template v-if="field.type === 'boolean'">
                        <button
                          type="button"
                          class="w-11 h-6 rounded-full border-none cursor-pointer relative transition-colors duration-[0.15s] ease p-0"
                          :class="field.value ? 'bg-accent-green' : 'bg-mid-gray'"
                          @click="setChannelField(entry.key, field.path, !field.value)"
                        >
                          <span
                            class="absolute top-[2px] left-[2px] w-5 h-5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.15)] transition-transform duration-[0.15s] ease"
                            :class="{ 'translate-x-5': field.value }"
                          ></span>
                        </button>
                      </template>
                      <input
                        v-else-if="field.type === 'number'"
                        :value="field.value"
                        type="number"
                        class="w-full px-[0.9rem] py-[0.6rem] bg-light border border-[var(--color-border)] rounded-sm text-dark font-body text-sm outline-none transition-[border-color,box-shadow] duration-[0.15s] ease focus:border-primary focus:shadow-[0_0_0_3px_rgba(217,119,87,0.12)]"
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
                        class="w-full px-[0.9rem] py-[0.6rem] bg-light border border-[var(--color-border)] rounded-sm text-dark font-body text-sm outline-none transition-[border-color,box-shadow] duration-[0.15s] ease focus:border-primary focus:shadow-[0_0_0_3px_rgba(217,119,87,0.12)] min-h-[60px] resize-y font-mono text-xs"
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
                        class="w-full px-[0.9rem] py-[0.6rem] bg-light border border-[var(--color-border)] rounded-sm text-dark font-body text-sm outline-none transition-[border-color,box-shadow] duration-[0.15s] ease focus:border-primary focus:shadow-[0_0_0_3px_rgba(217,119,87,0.12)]"
                        @input="
                          setChannelField(
                            entry.key,
                            field.path,
                            ($event.target as HTMLInputElement).value,
                          )
                        "
                      />
                    </div>
                  </template>
                </div>
              </div>
            </div>
          </div>
        </template>

        <template v-else>
          <div
            v-for="(plugin, index) in pluginEntries"
            :key="index"
            class="p-4 border border-[var(--color-border)] rounded bg-surface shadow-sm"
          >
            <div class="flex items-center justify-between gap-4 mb-0">
              <div>
                <div class="font-heading text-sm font-semibold text-dark mb-[0.35rem]">
                  {{ plugin.name || `Plugin ${index + 1}` }}
                </div>
              </div>
              <div class="flex items-center gap-2.5 mb-0">
                <div class="flex items-center gap-2.5 mb-0">
                  <label
                    class="font-heading text-xs font-medium text-dark tracking-[0.02em] uppercase whitespace-nowrap m-0"
                    >Enabled</label
                  >
                  <button
                    type="button"
                    class="w-11 h-6 rounded-full border-none cursor-pointer relative transition-colors duration-[0.15s] ease p-0"
                    :class="plugin.enabled ? 'bg-accent-green' : 'bg-mid-gray'"
                    @click="updatePluginField(index, 'enabled', !plugin.enabled)"
                  >
                    <span
                      class="absolute top-[2px] left-[2px] w-5 h-5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.15)] transition-transform duration-[0.15s] ease"
                      :class="{ 'translate-x-5': plugin.enabled }"
                    ></span>
                  </button>
                </div>
                <button
                  type="button"
                  class="inline-flex items-center justify-center p-1.5 border border-transparent rounded-sm cursor-pointer transition-all duration-[0.15s] ease bg-[#CF3A3A] text-white hover:bg-[#b83333] disabled:opacity-50 disabled:cursor-not-allowed"
                  @click="removePlugin(index)"
                >
                  <TrashIcon class="w-4 h-4" />
                </button>
              </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-0">
              <div
                v-if="getPluginFields(plugin).length > 0"
                class="col-span-1 md:col-span-2 lg:col-span-3 mt-1 pt-3"
              >
                <div
                  class="font-heading text-[0.7rem] font-semibold text-mid-gray uppercase tracking-[0.08em] mb-3"
                >
                  Options
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <template
                    v-for="field in getPluginFields(plugin)"
                    :key="`plugin-${index}-${field.key}`"
                  >
                    <div class="mb-5">
                      <label
                        class="block mb-[0.4rem] font-heading font-medium text-xs text-dark tracking-[0.02em] uppercase"
                        >{{ field.displayLabel }}</label
                      >
                      <template v-if="field.type === 'boolean'">
                        <button
                          type="button"
                          class="w-11 h-6 rounded-full border-none cursor-pointer relative transition-colors duration-[0.15s] ease p-0"
                          :class="field.value ? 'bg-accent-green' : 'bg-mid-gray'"
                          @click="setPluginOptionField(index, field.path, !field.value)"
                        >
                          <span
                            class="absolute top-[2px] left-[2px] w-5 h-5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.15)] transition-transform duration-[0.15s] ease"
                            :class="{ 'translate-x-5': field.value }"
                          ></span>
                        </button>
                      </template>
                      <input
                        v-else-if="field.type === 'number'"
                        :value="field.value"
                        type="number"
                        class="w-full px-[0.9rem] py-[0.6rem] bg-light border border-[var(--color-border)] rounded-sm text-dark font-body text-sm outline-none transition-[border-color,box-shadow] duration-[0.15s] ease focus:border-primary focus:shadow-[0_0_0_3px_rgba(217,119,87,0.12)]"
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
                        class="w-full px-[0.9rem] py-[0.6rem] bg-light border border-[var(--color-border)] rounded-sm text-dark font-body text-sm outline-none transition-[border-color,box-shadow] duration-[0.15s] ease focus:border-primary focus:shadow-[0_0_0_3px_rgba(217,119,87,0.12)] min-h-[60px] resize-y font-mono text-xs"
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
                        class="w-full px-[0.9rem] py-[0.6rem] bg-light border border-[var(--color-border)] rounded-sm text-dark font-body text-sm outline-none transition-[border-color,box-shadow] duration-[0.15s] ease focus:border-primary focus:shadow-[0_0_0_3px_rgba(217,119,87,0.12)]"
                        @input="
                          setPluginOptionField(
                            index,
                            field.path,
                            ($event.target as HTMLInputElement).value,
                          )
                        "
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

    <div
      v-if="toast"
      class="fixed top-5 right-5 px-5 py-[0.85rem] rounded-sm text-white font-heading font-medium text-sm z-[200] animate-[slideInRight_0.3s_cubic-bezier(0.16,1,0.3,1)] shadow-lg"
      :class="toast.type === 'toast-success' ? 'bg-accent-green' : 'bg-danger'"
    >
      {{ toast.message }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useAuth } from '@/composables/useAuth';
import { TrashIcon } from '@heroicons/vue/24/outline';

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

function removeChannel(key: string) {
  if (!isRecord(sectionValue.value)) return;
  const next = { ...sectionValue.value };
  delete next[key];
  sectionValue.value = next;
}

function getChannelEnabled(entry: ChannelEntry): boolean {
  return isRecord(entry.value) && typeof entry.value.enabled === 'boolean'
    ? entry.value.enabled
    : true;
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

onMounted(() => {
  void loadConfig();
});
</script>
