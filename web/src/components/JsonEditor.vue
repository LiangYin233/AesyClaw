<template>
  <textarea
    :value="modelValue"
    class="w-full px-3 py-2 border border-[var(--color-border)] rounded-sm font-mono text-xs bg-light text-dark outline-none focus:border-primary focus:ring-[3px] focus:ring-[rgba(217,119,87,0.12)] min-h-[200px] leading-relaxed resize-y"
    :placeholder="placeholder"
    @input="$emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
  />
</template>

<script setup lang="ts">
defineProps<{
  modelValue: string;
  placeholder?: string;
}>();

defineEmits<{
  (e: 'update:modelValue', value: string): void;
}>();
</script>
