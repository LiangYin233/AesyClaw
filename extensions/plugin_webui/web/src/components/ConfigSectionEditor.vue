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

        <div
          v-for="entry in entries"
          :key="entry.key"
          class="p-4 border border-[var(--color-border)] rounded bg-surface shadow-sm"
        >
          <div class="flex items-center justify-between gap-4 mb-0">
            <div>
              <div class="font-heading text-sm font-semibold text-dark mb-[0.35rem]">
                {{ entryTitle(entry) }}
              </div>
            </div>
            <div class="flex items-center gap-2.5 mb-0">
              <div class="flex items-center gap-2.5 mb-0">
                <label
                  class="font-heading text-xs font-medium text-dark tracking-[0.02em] uppercase whitespace-nowrap m-0"
                >
                  Enabled
                </label>
                <ToggleSwitch
                  :model-value="getEntryEnabled(entry)"
                  @update:model-value="toggleEntryEnabled(entry.key)"
                />
              </div>
              <button
                type="button"
                class="inline-flex items-center justify-center p-1.5 border border-transparent rounded-sm cursor-pointer transition-all duration-[0.15s] ease bg-[#CF3A3A] text-white hover:bg-[#b83333] disabled:opacity-50 disabled:cursor-not-allowed"
                @click="removeEntry(entry.key)"
              >
                <TrashIcon class="w-4 h-4" />
              </button>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-0">
            <div
              v-if="shouldShowFields(entry)"
              class="col-span-1 md:col-span-2 lg:col-span-3 mt-1 pt-3"
            >
              <div
                class="font-heading text-[0.7rem] font-semibold text-mid-gray uppercase tracking-[0.08em] mb-3"
              >
                {{ fieldSectionTitle }}
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div
                  v-for="field in getEntryFields(entry)"
                  :key="`${entry.key}-${field.key}`"
                  class="mb-5"
                >
                  <label
                    class="block mb-[0.4rem] font-heading font-medium text-xs text-dark tracking-[0.02em] uppercase"
                  >
                    {{ field.displayLabel }}
                  </label>
                  <template v-if="field.type === 'boolean'">
                    <ToggleSwitch
                      :model-value="Boolean(field.value)"
                      @update:model-value="setEntryField(entry.key, field.path, $event)"
                    />
                  </template>
                  <input
                    v-else-if="field.type === 'number'"
                    :value="field.value"
                    type="number"
                    class="w-full px-[0.9rem] py-[0.6rem] bg-light border border-[var(--color-border)] rounded-sm text-dark font-body text-sm outline-none transition-[border-color,box-shadow] duration-[0.15s] ease focus:border-primary focus:shadow-[0_0_0_3px_rgba(217,119,87,0.12)]"
                    @input="setEntryField(entry.key, field.path, parseNumberInput($event))"
                  />
                  <textarea
                    v-else-if="field.type === 'object'"
                    :value="toJson(field.value)"
                    class="w-full px-[0.9rem] py-[0.6rem] bg-light border border-[var(--color-border)] rounded-sm text-dark font-body text-sm outline-none transition-[border-color,box-shadow] duration-[0.15s] ease focus:border-primary focus:shadow-[0_0_0_3px_rgba(217,119,87,0.12)] min-h-[60px] resize-y font-mono text-xs"
                    rows="3"
                    @input="handleEntryComplexField(entry.key, field.path, textareaValue($event))"
                  />
                  <input
                    v-else
                    :value="field.value"
                    class="w-full px-[0.9rem] py-[0.6rem] bg-light border border-[var(--color-border)] rounded-sm text-dark font-body text-sm outline-none transition-[border-color,box-shadow] duration-[0.15s] ease focus:border-primary focus:shadow-[0_0_0_3px_rgba(217,119,87,0.12)]"
                    @input="setEntryField(entry.key, field.path, inputValue($event))"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useWebSocket } from '@/composables/useWebSocket';
import { useToast } from '@/composables/useToast';
import ToggleSwitch from '@/components/ToggleSwitch.vue';
import { isRecord, toJson } from '@/lib/object';
import { TrashIcon } from '@heroicons/vue/24/outline';

interface EntryItem {
  key: string;
  value: unknown;
}

type SectionKey = 'channels' | 'plugins';

const props = defineProps<{
  sectionKey: SectionKey;
  title: string;
  subtitle: string;
}>();

const ws = useWebSocket();
const { showToast } = useToast();

const sectionValue = ref<Record<string, unknown>>({});
const loading = ref(true);
const saving = ref(false);
const error = ref('');

const itemCount = computed(() => Object.keys(sectionValue.value).length);
const entries = computed<EntryItem[]>(() =>
  Object.entries(sectionValue.value).map(([key, value]) => ({ key, value })),
);
const fieldSectionTitle = computed(() => (props.sectionKey === 'channels' ? 'Configuration' : 'Options'));

async function loadConfig(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const config = (await ws.send('get_config')) as Record<string, unknown>;
    sectionValue.value = getSectionValue(config, props.sectionKey);
  } catch (err) {
    error.value = err instanceof Error ? err.message : `Failed to load ${props.sectionKey} config`;
  } finally {
    loading.value = false;
  }
}

async function saveSection(): Promise<void> {
  saving.value = true;
  try {
    await ws.send('update_config', { [props.sectionKey]: sectionValue.value });
    showToast('toast-success', `${props.title} configuration saved`);
  } catch (err) {
    showToast('toast-error', err instanceof Error ? err.message : 'Save failed');
  } finally {
    saving.value = false;
  }
}

function entryTitle(entry: EntryItem): string {
  if (entry.key.length > 0) return entry.key;
  return props.sectionKey === 'channels' ? 'New channel' : 'Plugin';
}

function removeEntry(key: string): void {
  const next = { ...sectionValue.value };
  delete next[key];
  sectionValue.value = next;
}

function getEntryEnabled(entry: EntryItem): boolean {
  return isRecord(entry.value) && typeof entry.value['enabled'] === 'boolean'
    ? entry.value['enabled']
    : true;
}

async function toggleEntryEnabled(key: string): Promise<void> {
  const current = sectionValue.value;
  const entryValue = isRecord(current[key]) ? current[key] : {};
  const enabled = entryValue['enabled'] === false;
  sectionValue.value = { ...current, [key]: { ...entryValue, enabled } };

  try {
    const wsType = props.sectionKey === 'plugins' ? 'set_plugin_enabled' : 'set_channel_enabled';
    await ws.send(wsType, { name: key, enabled });
    showToast('toast-success', `${key} ${enabled ? 'enabled' : 'disabled'}`);
  } catch (err) {
    sectionValue.value = current;
    showToast('toast-error', err instanceof Error ? err.message : 'Failed to update');
  }
}

interface ConfigField {
  path: string;
  key: string;
  displayLabel: string;
  value: unknown;
  type: 'string' | 'number' | 'boolean' | 'object';
}

function shouldShowFields(entry: EntryItem): boolean {
  return props.sectionKey === 'channels' || getEntryFields(entry).length > 0;
}

function getEntryFields(entry: EntryItem): ConfigField[] {
  return isRecord(entry.value) ? getFields(entry.value, ['enabled']) : [];
}

function getFields(record: Record<string, unknown>, skipKeys: string[] = []): ConfigField[] {
  const skip = new Set(skipKeys);
  return Object.entries(flattenObject(record))
    .filter(([key]) => !skip.has(key))
    .map(([key, value]) => ({
      path: key,
      key,
      displayLabel: formatFieldLabel(key),
      value,
      type: getFieldType(value),
    }));
}

function getFieldType(value: unknown): ConfigField['type'] {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'object' && value !== null) return 'object';
  return 'string';
}

function flattenObject(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isRecord(value) && Object.keys(value).length > 0) {
      Object.assign(result, flattenObject(value, path));
    } else {
      result[path] = value;
    }
  }
  return result;
}

function setEntryField(entryKey: string, path: string, value: unknown): void {
  const entryConfig = isRecord(sectionValue.value[entryKey]) ? { ...sectionValue.value[entryKey] } : {};
  setNestedValue(entryConfig, path, value);
  sectionValue.value = { ...sectionValue.value, [entryKey]: entryConfig };
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!part) continue;
    if (!isRecord(current[part])) current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  const lastPart = parts[parts.length - 1];
  if (lastPart) current[lastPart] = value;
}

function handleEntryComplexField(entryKey: string, path: string, raw: string): void {
  try {
    setEntryField(entryKey, path, JSON.parse(raw));
  } catch {
    // Keep the existing value until the JSON draft becomes valid.
  }
}

function formatFieldLabel(key: string): string {
  return key
    .split('.')
    .map((part) =>
      part
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase()),
    )
    .join(' > ');
}

function getSectionValue(source: unknown, key: SectionKey): Record<string, unknown> {
  if (!isRecord(source)) return {};
  const value = source[key];
  return isRecord(value) ? value : {};
}

function inputValue(event: Event): string {
  return (event.target as HTMLInputElement).value;
}

function textareaValue(event: Event): string {
  return (event.target as HTMLTextAreaElement).value;
}

function parseNumberInput(event: Event): number {
  const parsed = Number.parseFloat(inputValue(event));
  return Number.isFinite(parsed) ? parsed : 0;
}

onMounted(() => {
  void loadConfig();
});
</script>
