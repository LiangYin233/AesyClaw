<template>
  <input
    class="ui-input"
    :class="{ 'ui-input--fluid': fluid }"
    :type="type"
    :value="modelValue ?? ''"
    v-bind="$attrs"
    @input="onInput"
    @change="emit('change', $event)"
  />
</template>

<script setup lang="ts">
defineOptions({ inheritAttrs: false })

interface Props {
  modelValue?: string | number | null
  type?: string
  fluid?: boolean
}

withDefaults(defineProps<Props>(), {
  modelValue: '',
  type: 'text',
  fluid: false
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  change: [event: Event]
}>()

function onInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement).value)
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
  font: inherit;
  outline: none;
  transition: border-color 0.18s ease, box-shadow 0.18s ease, background-color 0.18s ease;
}

.ui-input:focus {
  border-color: color-mix(in srgb, var(--ui-accent) 45%, var(--ui-border));
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--ui-accent) 12%, transparent);
}

.ui-input::placeholder {
  color: var(--ui-text-faint);
}

.ui-input:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}
</style>
