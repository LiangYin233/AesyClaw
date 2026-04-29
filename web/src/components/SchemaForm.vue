<template>
  <div class="schema-form">
    <!-- Object with properties -->
    <template v-if="resolvedType === 'object-properties'">
      <template v-if="label">
        <fieldset class="fieldset">
          <legend>{{ displayLabel }}</legend>
          <div v-for="key in sortedKeys" :key="key" class="field-group">
            <SchemaForm
              :schema="resolvedSchema.properties![key]"
              :model-value="modelValueObj[key]"
              :label="key"
              :path="`${path}.${key}`"
              @update:model-value="updateProperty(key, $event)"
            />
          </div>
        </fieldset>
      </template>
      <template v-else>
        <div v-for="key in sortedKeys" :key="key" class="field-group">
          <SchemaForm
            :schema="resolvedSchema.properties![key]"
            :model-value="modelValueObj[key]"
            :label="key"
            :path="`${path}.${key}`"
            @update:model-value="updateProperty(key, $event)"
          />
        </div>
      </template>
    </template>

    <!-- Record / dictionary -->
    <template v-else-if="resolvedType === 'object-record'">
      <fieldset class="fieldset">
        <legend v-if="label">{{ displayLabel }}</legend>
        <div v-for="(entry, idx) in recordEntries" :key="idx" class="array-item">
          <input
            v-model="entry.key"
            class="form-input"
            placeholder="Key"
            @change="updateRecord()"
          />
          <SchemaForm
            :schema="recordValueSchema"
            :model-value="entry.value"
            label=""
            :path="`${path}[${entry.key}]`"
            @update:model-value="
              entry.value = $event;
              updateRecord();
            "
          />
          <button type="button" class="btn btn-danger btn-sm" @click="removeRecordEntry(idx)">
            Remove
          </button>
        </div>
        <button type="button" class="btn btn-primary btn-sm" @click="addRecordEntry">
          + Add {{ label || 'Entry' }}
        </button>
      </fieldset>
    </template>

    <!-- Array -->
    <template v-else-if="resolvedType === 'array'">
      <fieldset class="fieldset">
        <legend v-if="label">{{ displayLabel }}</legend>
        <div v-for="(item, idx) in modelValueArr" :key="idx" class="array-item">
          <SchemaForm
            :schema="resolvedSchema.items!"
            :model-value="item"
            label=""
            :path="`${path}[${idx}]`"
            @update:model-value="updateArrayItem(idx, $event)"
          />
          <button type="button" class="btn btn-danger btn-sm" @click="removeArrayItem(idx)">
            Remove
          </button>
        </div>
        <button type="button" class="btn btn-primary btn-sm" @click="addArrayItem">
          + Add {{ label || 'Item' }}
        </button>
      </fieldset>
    </template>

    <!-- String -->
    <template v-else-if="resolvedType === 'string'">
      <label v-if="label" class="field-label">{{ displayLabel }}</label>
      <input
        :value="stringValue"
        type="text"
        class="form-input"
        :placeholder="displayLabel"
        @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      />
    </template>

    <!-- Number -->
    <template v-else-if="resolvedType === 'number'">
      <label v-if="label" class="field-label">{{ displayLabel }}</label>
      <input
        :value="numberValue"
        type="number"
        class="form-input"
        :placeholder="displayLabel"
        @input="$emit('update:modelValue', Number(($event.target as HTMLInputElement).value))"
      />
    </template>

    <!-- Boolean -->
    <template v-else-if="resolvedType === 'boolean'">
      <div class="form-group toggle-group">
        <label class="field-label">{{ displayLabel }}</label>
        <button
          type="button"
          class="toggle-switch"
          :class="{ active: booleanValue }"
          @click="$emit('update:modelValue', !booleanValue)"
        >
          <span class="toggle-thumb"></span>
        </button>
      </div>
    </template>

    <!-- Enum / Union -->
    <template v-else-if="resolvedType === 'enum'">
      <label v-if="label" class="field-label">{{ displayLabel }}</label>
      <select
        :value="modelValue"
        class="form-select"
        @change="$emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
      >
        <option v-for="opt in enumOptions" :key="opt" :value="opt">{{ opt }}</option>
      </select>
    </template>

    <!-- Fallback: raw JSON -->
    <template v-else>
      <label v-if="label" class="field-label">{{ displayLabel }}</label>
      <JsonEditor :model-value="jsonValue" @update:model-value="updateJson" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import JsonEditor from './JsonEditor.vue';

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
  modelValue: unknown;
  label?: string;
  path?: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: unknown): void;
}>();

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
  return typeof props.modelValue === 'object' &&
    props.modelValue !== null &&
    !Array.isArray(props.modelValue)
    ? (props.modelValue as Record<string, unknown>)
    : {};
});

const recordValueSchema = computed<JsonSchema>(() => {
  const ap = resolvedSchema.value.additionalProperties;
  return typeof ap === 'object' && ap !== null ? ap : {};
});

const stringValue = computed(() => (typeof props.modelValue === 'string' ? props.modelValue : ''));
const numberValue = computed(() => (typeof props.modelValue === 'number' ? props.modelValue : 0));
const booleanValue = computed(() => Boolean(props.modelValue));

const modelValueArr = computed<unknown[]>(() => {
  if (Array.isArray(props.modelValue)) return props.modelValue;
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

const jsonValue = computed(() => JSON.stringify(props.modelValue, null, 2));

function updateJson(raw: string) {
  try {
    emit('update:modelValue', JSON.parse(raw));
  } catch {
    // ignore invalid JSON while typing
  }
}

function updateProperty(key: string, value: unknown) {
  const current =
    typeof props.modelValue === 'object' && props.modelValue !== null
      ? (props.modelValue as Record<string, unknown>)
      : {};
  emit('update:modelValue', { ...current, [key]: value });
}

function updateArrayItem(idx: number, value: unknown) {
  const arr = [...modelValueArr.value];
  arr[idx] = value;
  emit('update:modelValue', arr);
}

function addArrayItem() {
  const arr = [...modelValueArr.value];
  arr.push(getDefaultValue(resolvedSchema.value.items ?? {}));
  emit('update:modelValue', arr);
}

function removeArrayItem(idx: number) {
  const arr = [...modelValueArr.value];
  arr.splice(idx, 1);
  emit('update:modelValue', arr);
}

interface RecordEntry {
  key: string;
  value: unknown;
}

const recordEntries = ref<RecordEntry[]>([]);

watch(
  () => props.modelValue,
  (val) => {
    if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      recordEntries.value = Object.entries(val).map(([k, v]) => ({ key: k, value: v }));
    } else {
      recordEntries.value = [];
    }
  },
  { immediate: true },
);

function updateRecord() {
  const obj: Record<string, unknown> = {};
  for (const entry of recordEntries.value) {
    if (entry.key) {
      obj[entry.key] = entry.value;
    }
  }
  emit('update:modelValue', obj);
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

<style scoped>
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
</style>
