<template>
  <div class="ui-message" :class="`ui-message--${severity}`" role="alert">
    <UiIcon :name="severity === 'warn' ? 'warning' : severity === 'error' ? 'warning' : severity === 'success' ? 'check' : 'info'" />
    <div class="ui-message__content">
      <slot></slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import UiIcon from './UiIcon.vue'

interface Props {
  severity?: 'info' | 'success' | 'warn' | 'error'
}

withDefaults(defineProps<Props>(), {
  severity: 'info'
})
</script>

<style scoped>
.ui-message {
  display: flex;
  align-items: flex-start;
  gap: 0.7rem;
  padding: 0.85rem 0.95rem;
  border-radius: 1rem;
  border: 1px solid transparent;
}

.ui-message__content {
  color: inherit;
  line-height: 1.6;
}

.ui-message--info { background: var(--ui-info-soft); color: var(--ui-info-text); border-color: color-mix(in srgb, var(--ui-info) 18%, transparent); }
.ui-message--success { background: var(--ui-success-soft); color: var(--ui-success-text); border-color: color-mix(in srgb, var(--ui-success) 18%, transparent); }
.ui-message--warn { background: var(--ui-warning-soft); color: var(--ui-warning-text); border-color: color-mix(in srgb, var(--ui-warning) 18%, transparent); }
.ui-message--error { background: var(--ui-danger-soft); color: var(--ui-danger-text); border-color: color-mix(in srgb, var(--ui-danger) 18%, transparent); }
</style>
