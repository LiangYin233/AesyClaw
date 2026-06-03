<template>
  <textarea
    v-model="model"
    class="w-full px-3 py-2 border border-[var(--color-border)] rounded-sm font-mono text-xs bg-light text-dark outline-none focus:border-primary focus:ring-[3px] focus:ring-[rgba(217,119,87,0.12)] min-h-[200px] leading-relaxed resize-y"
    :placeholder="placeholder"
  />
</template>

<script setup lang="ts">
const model = defineModel<string>({ required: true });

defineProps<{
  placeholder?: string;
}>();
</script>
