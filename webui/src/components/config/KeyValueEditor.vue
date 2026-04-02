<template>
  <div class="space-y-3">
    <div
      v-for="[key, value] in entries"
      :key="key"
      class="grid grid-cols-1 gap-3 rounded-xl border border-outline-variant/12 bg-surface px-3 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
    >
      <input
        :value="key"
        class="tech-text w-full rounded-lg bg-surface-container-low px-3 py-2 text-sm text-on-surface outline-none transition focus:ring-2 focus:ring-primary/20"
        type="text"
        placeholder="键名"
        @change="renameKey(key, ($event.target as HTMLInputElement).value)"
      />
      <input
        :value="value"
        class="tech-text w-full rounded-lg bg-surface-container-low px-3 py-2 text-sm text-on-surface outline-none transition focus:ring-2 focus:ring-primary/20"
        type="text"
        placeholder="值"
        @input="updateValue(key, ($event.target as HTMLInputElement).value)"
      />
      <button
        class="rounded-lg border border-error/20 px-3 py-2 text-sm font-semibold text-error transition hover:bg-error-container/60"
        type="button"
        @click="removeKey(key)"
      >
        删除
      </button>
    </div>

    <div v-if="!entries.length" class="rounded-xl bg-surface px-3 py-3 text-sm text-on-surface-variant">
      暂无配置项。
    </div>

    <button
      class="rounded-xl bg-surface-container-high px-4 py-2 text-sm font-semibold text-on-surface transition hover:bg-surface-container-highest"
      type="button"
      @click="addKey"
    >
      新增键值
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  modelValue?: Record<string, string>;
}>();

const emit = defineEmits<{
  'update:modelValue': [Record<string, string>];
}>();

const entries = computed(() => Object.entries(props.modelValue || {}));

function emitValue(next: Record<string, string>) {
  emit('update:modelValue', next);
}

function addKey() {
  const current = props.modelValue || {};
  let index = 1;
  let key = `key${index}`;
  while (current[key] !== undefined) {
    index += 1;
    key = `key${index}`;
  }

  emitValue({
    ...current,
    [key]: ''
  });
}

function renameKey(oldKey: string, nextKeyRaw: string) {
  const nextKey = nextKeyRaw.trim();
  if (!nextKey || nextKey === oldKey) {
    return;
  }

  const current = props.modelValue || {};
  if (current[nextKey] !== undefined) {
    return;
  }

  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(current)) {
    next[key === oldKey ? nextKey : key] = value;
  }
  emitValue(next);
}

function updateValue(key: string, value: string) {
  emitValue({
    ...(props.modelValue || {}),
    [key]: value
  });
}

function removeKey(key: string) {
  const next = { ...(props.modelValue || {}) };
  delete next[key];
  emitValue(next);
}
</script>
