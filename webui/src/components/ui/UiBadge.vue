<template>
  <span class="ui-badge" :class="[badgeClass, { 'ui-badge--rounded': rounded }]">
    <UiIcon v-if="icon" :name="icon" size="sm" />
    <slot>{{ value }}</slot>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import UiIcon from './UiIcon.vue'

interface Props {
  value?: string
  severity?: 'primary' | 'secondary' | 'success' | 'warn' | 'warning' | 'danger' | 'info' | 'contrast'
  rounded?: boolean
  icon?: string
}

const props = withDefaults(defineProps<Props>(), {
  value: '',
  severity: 'secondary',
  rounded: false,
  icon: ''
})

const badgeClass = computed(() => `ui-badge--${props.severity === 'warning' ? 'warn' : props.severity}`)
</script>

<style scoped>
.ui-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.38rem;
  min-height: 1.7rem;
  padding: 0 0.65rem;
  border-radius: 0.75rem;
  border: 1px solid transparent;
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.01em;
}

.ui-badge--rounded {
  border-radius: 999px;
}

.ui-badge--primary { background: color-mix(in srgb, var(--ui-accent) 14%, var(--ui-panel)); color: var(--ui-accent-strong); border-color: color-mix(in srgb, var(--ui-accent) 20%, transparent); }
.ui-badge--secondary { background: var(--ui-muted); color: var(--ui-text-soft); border-color: var(--ui-border-subtle); }
.ui-badge--success { background: var(--ui-success-soft); color: var(--ui-success-text); border-color: color-mix(in srgb, var(--ui-success) 20%, transparent); }
.ui-badge--warn { background: var(--ui-warning-soft); color: var(--ui-warning-text); border-color: color-mix(in srgb, var(--ui-warning) 20%, transparent); }
.ui-badge--danger { background: var(--ui-danger-soft); color: var(--ui-danger-text); border-color: color-mix(in srgb, var(--ui-danger) 20%, transparent); }
.ui-badge--info { background: var(--ui-info-soft); color: var(--ui-info-text); border-color: color-mix(in srgb, var(--ui-info) 20%, transparent); }
.ui-badge--contrast { background: color-mix(in srgb, var(--ui-text) 92%, transparent); color: var(--ui-panel); }
</style>
