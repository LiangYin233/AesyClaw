<template>
  <span class="ui-spinner" :style="spinnerStyle" aria-hidden="true"></span>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  size?: string
}

const props = withDefaults(defineProps<Props>(), {
  size: '1.5rem'
})

const spinnerStyle = computed(() => ({
  width: props.size,
  height: props.size
}))
</script>

<style scoped>
.ui-spinner {
  display: inline-block;
  border-radius: 999px;
  border: 2px solid color-mix(in srgb, var(--ui-accent) 20%, transparent);
  border-top-color: var(--ui-accent-strong);
  animation: ui-spin 0.8s linear infinite;
}

@keyframes ui-spin {
  to { transform: rotate(360deg); }
}
</style>
