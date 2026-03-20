<template>
  <textarea
    class="ui-textarea"
    :value="modelValue ?? ''"
    v-bind="$attrs"
    @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
  ></textarea>
</template>

<script setup lang="ts">
defineOptions({ inheritAttrs: false })

interface Props {
  modelValue?: string | null
}

withDefaults(defineProps<Props>(), {
  modelValue: ''
})

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<style scoped>
.ui-textarea {
  width: 100%;
  min-height: 8rem;
  padding: 0.8rem 0.9rem;
  border-radius: 1rem;
  border: 1px solid var(--ui-border);
  background: var(--ui-input-bg);
  color: var(--ui-text);
  font: inherit;
  line-height: 1.6;
  resize: vertical;
  outline: none;
  transition: border-color 0.18s ease, box-shadow 0.18s ease, background-color 0.18s ease;
}

.ui-textarea:focus {
  border-color: color-mix(in srgb, var(--ui-accent) 45%, var(--ui-border));
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--ui-accent) 12%, transparent);
}
</style>
