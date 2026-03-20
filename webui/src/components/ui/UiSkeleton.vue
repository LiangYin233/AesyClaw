<template>
  <span class="ui-skeleton" :style="styleObject"></span>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  width?: string
  height?: string
  borderRadius?: string
}

const props = withDefaults(defineProps<Props>(), {
  width: '100%',
  height: '1rem',
  borderRadius: '0.75rem'
})

const styleObject = computed(() => ({
  width: props.width,
  height: props.height,
  borderRadius: props.borderRadius
}))
</script>

<style scoped>
.ui-skeleton {
  display: inline-flex;
  background: linear-gradient(90deg, color-mix(in srgb, var(--ui-muted) 88%, transparent), color-mix(in srgb, white 40%, var(--ui-muted)), color-mix(in srgb, var(--ui-muted) 88%, transparent));
  background-size: 200% 100%;
  animation: ui-skeleton 1.4s ease infinite;
}

@keyframes ui-skeleton {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}
</style>
