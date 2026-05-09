<template>
  <div class="schema-form">
    <template v-if="resolvedType === 'object-properties'">
      <template v-if="label">
        <fieldset
          class="border border-[var(--color-border)] rounded p-5 mb-5 bg-[rgba(250,249,245,0.5)] shadow-sm"
        >
          <legend class="px-3 font-heading font-semibold text-sm text-dark">
            {{ displayLabel }}
          </legend>
          <div v-for="key in sortedKeys" :key="key" class="mb-5">
            <SchemaForm
              :schema="resolvedSchema.properties![key] || {}"
              :model-value="modelValueObj[key]"
              :label="key"
              :path="`${path}.${key}`"
              @update:model-value="updateProperty(key, $event)"
            />
          </div>
        </fieldset>
      </template>
      <template v-else>
        <div v-for="key in sortedKeys" :key="key" class="mb-5">
          <SchemaForm
            :schema="resolvedSchema.properties![key] || {}"
            :model-value="modelValueObj[key]"
            :label="key"
            :path="`${path}.${key}`"
            @update:model-value="updateProperty(key, $event)"
          />
        </div>
      </template>
    </template>

    <template v-else-if="resolvedType === 'object-record'">
      <fieldset
        class="border border-[var(--color-border)] rounded p-5 mb-5 bg-[rgba(250,249,245,0.5)] shadow-sm"
      >
        <legend v-if="label" class="px-3 font-heading font-semibold text-sm text-dark">
          {{ displayLabel }}
        </legend>
        <div v-for="(entry, idx) in recordEntries" :key="`${entry.key}-${idx}`" class="flex items-start gap-2 mb-2">
          <input
            :value="entry.key"
            class="flex-1 w-full px-[0.9rem] py-[0.6rem] bg-light border border-[var(--color-border)] rounded-sm text-dark font-body text-sm outline-none transition-[border-color,box-shadow] duration-[0.15s] ease focus:border-primary focus:shadow-[0_0_0_3px_rgba(217,119,87,0.12)]"
            placeholder="Key"
            @input="updateRecordEntryKey(idx, ($event.target as HTMLInputElement).value)"
          />
          <SchemaForm
            :schema="recordValueSchema"
            :model-value="entry.value"
            label=""
            :path="`${path}[${entry.key}]`"
            @update:model-value="updateRecordEntryValue(idx, $event)"
          />
          <button
            type="button"
            class="inline-flex items-center justify-center p-1.5 border border-transparent rounded-sm cursor-pointer transition-all duration-[0.15s] ease bg-[#CF3A3A] text-white hover:bg-[#b83333] disabled:opacity-50 disabled:cursor-not-allowed"
            @click="removeRecordEntry(idx)"
          >
            <TrashIcon class="w-4 h-4" />
          </button>
        </div>
        <button
          type="button"
          class="inline-flex items-center justify-center gap-1.5 px-[1.1rem] py-[0.55rem] border border-transparent rounded-sm font-heading text-xs font-medium cursor-pointer transition-all duration-[0.15s] ease tracking-[0.01em] uppercase bg-[#121212] text-white hover:bg-[#2a2a2a] hover:-translate-y-[1px] hover:shadow-[0_4px_12px_rgba(18,18,18,0.25)] disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none"
          @click="addRecordEntry"
        >
          + Add {{ label || 'Entry' }}
        </button>
      </fieldset>
    </template>

    <template v-else-if="resolvedType === 'array'">
      <fieldset
        class="border border-[var(--color-border)] rounded p-5 mb-5 bg-[rgba(250,249,245,0.5)] shadow-sm"
      >
        <legend v-if="label" class="px-3 font-heading font-semibold text-sm text-dark">
          {{ displayLabel }}
        </legend>
        <div v-for="(item, idx) in modelValueArr" :key="`item-${idx}`" class="flex items-start gap-2 mb-2">
          <SchemaForm
            :schema="resolvedSchema.items!"
            :model-value="item"
            label=""
            :path="`${path}[${idx}]`"
            @update:model-value="updateArrayItem(idx, $event)"
          />
          <button
            type="button"
            class="inline-flex items-center justify-center p-1.5 border border-transparent rounded-sm cursor-pointer transition-all duration-[0.15s] ease bg-[#CF3A3A] text-white hover:bg-[#b83333] disabled:opacity-50 disabled:cursor-not-allowed"
            @click="removeArrayItem(idx)"
          >
            <TrashIcon class="w-4 h-4" />
          </button>
        </div>
        <button
          type="button"
          class="inline-flex items-center justify-center gap-1.5 px-[1.1rem] py-[0.55rem] border border-transparent rounded-sm font-heading text-xs font-medium cursor-pointer transition-all duration-[0.15s] ease tracking-[0.01em] uppercase bg-[#121212] text-white hover:bg-[#2a2a2a] hover:-translate-y-[1px] hover:shadow-[0_4px_12px_rgba(18,18,18,0.25)] disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none"
          @click="addArrayItem"
        >
          + Add {{ label || 'Item' }}
        </button>
      </fieldset>
    </template>

    <template v-else-if="resolvedType === 'string'">
      <label
        v-if="label"
        class="block mb-[0.4rem] font-heading font-medium text-xs text-dark tracking-[0.02em] uppercase"
        >{{ displayLabel }}</label
      >
      <input
        :value="stringValue"
        type="text"
        class="w-full px-[0.9rem] py-[0.6rem] bg-light border border-[var(--color-border)] rounded-sm text-dark font-body text-sm outline-none transition-[border-color,box-shadow] duration-[0.15s] ease focus:border-primary focus:shadow-[0_0_0_3px_rgba(217,119,87,0.12)]"
        :placeholder="displayLabel"
        @input="model = ($event.target as HTMLInputElement).value"
      />
    </template>

    <template v-else-if="resolvedType === 'number'">
      <label
        v-if="label"
        class="block mb-[0.4rem] font-heading font-medium text-xs text-dark tracking-[0.02em] uppercase"
        >{{ displayLabel }}</label
      >
      <input
        :value="numberValue"
        type="number"
        class="w-full px-[0.9rem] py-[0.6rem] bg-light border border-[var(--color-border)] rounded-sm text-dark font-body text-sm outline-none transition-[border-color,box-shadow] duration-[0.15s] ease focus:border-primary focus:shadow-[0_0_0_3px_rgba(217,119,87,0.12)]"
        :placeholder="displayLabel"
        @input="model = Number(($event.target as HTMLInputElement).value)"
      />
    </template>

    <template v-else-if="resolvedType === 'boolean'">
      <div class="flex flex-col items-start gap-2 mb-5">
        <label
          class="block mb-0 font-heading font-medium text-xs text-dark tracking-[0.02em] uppercase"
          >{{ displayLabel }}</label
        >
        <ToggleSwitch :model-value="booleanValue" @update:model-value="model = $event" />
      </div>
    </template>

    <template v-else-if="resolvedType === 'enum'">
      <label
        v-if="label"
        class="block mb-[0.4rem] font-heading font-medium text-xs text-dark tracking-[0.02em] uppercase"
        >{{ displayLabel }}</label
      >
      <select
        :value="model"
        class="w-full px-[0.9rem] py-[0.6rem] bg-light border border-[var(--color-border)] rounded-sm text-dark font-body text-sm outline-none transition-[border-color,box-shadow] duration-[0.15s] ease focus:border-primary focus:shadow-[0_0_0_3px_rgba(217,119,87,0.12)]"
        @change="model = ($event.target as HTMLSelectElement).value"
      >
        <option v-for="opt in enumOptions" :key="opt" :value="opt">{{ opt }}</option>
      </select>
    </template>

    <template v-else>
      <label
        v-if="label"
        class="block mb-[0.4rem] font-heading font-medium text-xs text-dark tracking-[0.02em] uppercase"
        >{{ displayLabel }}</label
      >
      <JsonEditor :model-value="jsonValue" @update:model-value="updateJson" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import JsonEditor from './JsonEditor.vue';
import ToggleSwitch from './ToggleSwitch.vue';
import { TrashIcon } from '@heroicons/vue/24/outline';

interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: JsonSchema | boolean;
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  enum?: (string | number)[];
  const?: string | number;
  default?: unknown;
  [key: string]: unknown;
}

const props = defineProps<{
  schema: JsonSchema;
  label?: string;
  path?: string;
}>();

const model = defineModel<unknown>({ required: true });

const path = computed(() => props.path ?? props.label ?? 'root');

function unwrapOptional(schema: JsonSchema): JsonSchema {
  if (schema.anyOf && schema.anyOf.length === 2) {
    const hasUndefined = schema.anyOf.some((s) => (s as JsonSchema).type === 'undefined');
    if (hasUndefined) {
      return schema.anyOf.find((s) => (s as JsonSchema).type !== 'undefined') as JsonSchema;
    }
  }
  return schema;
}

const resolvedSchema = computed(() => unwrapOptional(props.schema));

const resolvedType = computed(() => {
  const s = resolvedSchema.value;
  if (s.type === 'object' && s.properties && Object.keys(s.properties).length > 0) {
    return 'object-properties';
  }
  if (s.type === 'object' && s.additionalProperties && typeof s.additionalProperties === 'object') {
    return 'object-record';
  }
  if (s.type === 'array') {
    return 'array';
  }
  if (s.type === 'string') {
    return 'string';
  }
  if (s.type === 'number' || s.type === 'integer') {
    return 'number';
  }
  if (s.type === 'boolean') {
    return 'boolean';
  }
  if (s.enum || (s.anyOf && s.anyOf.every((x) => (x as JsonSchema).const !== undefined))) {
    return 'enum';
  }
  return 'fallback';
});

const displayLabel = computed(() => formatLabel(props.label ?? ''));

const sortedKeys = computed(() => {
  const propsObj = resolvedSchema.value.properties ?? {};
  return Object.keys(propsObj);
});

const modelValueObj = computed<Record<string, unknown>>(() => {
  return typeof model.value === 'object' &&
    model.value !== null &&
    !Array.isArray(model.value)
    ? (model.value as Record<string, unknown>)
    : {};
});

const recordValueSchema = computed<JsonSchema>(() => {
  const ap = resolvedSchema.value.additionalProperties;
  return typeof ap === 'object' && ap !== null ? ap : {};
});

const stringValue = computed(() => (typeof model.value === 'string' ? model.value : ''));
const numberValue = computed(() => (typeof model.value === 'number' ? model.value : 0));
const booleanValue = computed(() => Boolean(model.value));

const modelValueArr = computed<unknown[]>(() => {
  if (Array.isArray(model.value)) return model.value;
  const def = resolvedSchema.value.default;
  return Array.isArray(def) ? def : [];
});

const enumOptions = computed(() => {
  const s = resolvedSchema.value;
  if (s.enum) return s.enum.map(String);
  if (s.anyOf) {
    return s.anyOf
      .filter((x) => (x as JsonSchema).const !== undefined)
      .map((x) => String((x as JsonSchema).const));
  }
  return [];
});

const jsonValue = computed(() => JSON.stringify(model.value, null, 2));

function updateJson(raw: string) {
  try {
    model.value = JSON.parse(raw);
  } catch {
    // ignore invalid JSON while typing
  }
}

function updateProperty(key: string, value: unknown) {
  const current =
    typeof model.value === 'object' && model.value !== null
      ? (model.value as Record<string, unknown>)
      : {};
  model.value = { ...current, [key]: value };
}

function updateArrayItem(idx: number, value: unknown) {
  const arr = [...modelValueArr.value];
  arr[idx] = value;
  model.value = arr;
}

function addArrayItem() {
  const arr = [...modelValueArr.value];
  arr.push(getDefaultValue(resolvedSchema.value.items ?? {}));
  model.value = arr;
}

function removeArrayItem(idx: number) {
  const arr = [...modelValueArr.value];
  arr.splice(idx, 1);
  model.value = arr;
}

interface RecordEntry {
  key: string;
  value: unknown;
}

const recordEntries = ref<RecordEntry[]>([]);

watch(
  () => model.value,
  (val) => {
    if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      recordEntries.value = Object.entries(val).map(([k, v]) => ({ key: k, value: v }));
    } else {
      recordEntries.value = [];
    }
  },
  { immediate: true },
);

function updateRecordEntryKey(idx: number, key: string) {
  const next = [...recordEntries.value];
  next[idx] = { ...next[idx], key } as RecordEntry;
  recordEntries.value = next;
  updateRecord();
}

function updateRecordEntryValue(idx: number, value: unknown) {
  const next = [...recordEntries.value];
  const current = next[idx];
  if (!current) return;
  next[idx] = { ...current, value };
  recordEntries.value = next;
  updateRecord();
}

function updateRecord() {
  const obj: Record<string, unknown> = {};
  for (const entry of recordEntries.value) {
    if (entry.key) {
      obj[entry.key] = entry.value;
    }
  }
  model.value = obj;
}

function addRecordEntry() {
  recordEntries.value.push({
    key: '',
    value: getDefaultValue(resolvedSchema.value.additionalProperties as JsonSchema),
  });
}

function removeRecordEntry(idx: number) {
  recordEntries.value.splice(idx, 1);
  updateRecord();
}

function getDefaultValue(s: JsonSchema): unknown {
  if (s.default !== undefined) return s.default;
  if (s.type === 'object') return {};
  if (s.type === 'array') return [];
  if (s.type === 'string') return '';
  if (s.type === 'number' || s.type === 'integer') return 0;
  if (s.type === 'boolean') return false;
  if (s.enum && s.enum.length > 0) return s.enum[0];
  if (s.anyOf && s.anyOf.length > 0) {
    const first = s.anyOf[0] as JsonSchema;
    if (first.const !== undefined) return first.const;
  }
  return null;
}

function formatLabel(label: string): string {
  const titleMap: Record<string, string> = {
    speechToText: 'Speech-to-text',
    imageUnderstanding: 'Image-understanding',
  };
  if (titleMap[label]) return titleMap[label];
  return label
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^\w/, (char) => char.toUpperCase());
}
</script>
