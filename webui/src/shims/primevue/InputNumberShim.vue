<template>
  <input
    class="ui-input"
    type="number"
    :value="modelValue ?? ''"
    v-bind="$attrs"
    @input="handleInput"
  />
</template>

<script setup lang="ts">
defineOptions({ inheritAttrs: false })

interface Props {
  modelValue?: number | null
}

withDefaults(defineProps<Props>(), {
  modelValue: null
})

const emit = defineEmits<{
  'update:modelValue': [value: number | null]
}>()

function handleInput(event: Event) {
  const rawValue = (event.target as HTMLInputElement).value
  emit('update:modelValue', rawValue === '' ? null : Number(rawValue))
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
