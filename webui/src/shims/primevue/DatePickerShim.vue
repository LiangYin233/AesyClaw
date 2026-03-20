<template>
  <input
    class="ui-input"
    type="datetime-local"
    :value="stringValue"
    v-bind="$attrs"
    @input="handleInput"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'

defineOptions({ inheritAttrs: false })

interface Props {
  modelValue?: Date | string | null
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: null
})

const emit = defineEmits<{ 'update:modelValue': [value: Date | null] }>()

const stringValue = computed(() => {
  if (!props.modelValue) {
    return ''
  }

  const date = props.modelValue instanceof Date ? props.modelValue : new Date(props.modelValue)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
})

function handleInput(event: Event) {
  const rawValue = (event.target as HTMLInputElement).value
  emit('update:modelValue', rawValue ? new Date(rawValue) : null)
}
</script>

<style scoped>
.ui-input {
  width: 100%;
  min-height: 2.8rem;
  padding: 0 0.9rem;
  border-radius: 0.95rem;
  border: 1px solid var(--ui-border);
  background: var(--ui-input-bg);
  color: var(--ui-text);
}
</style>
