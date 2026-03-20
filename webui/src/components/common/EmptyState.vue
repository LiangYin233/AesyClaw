<template>
  <div class="empty-state" role="status">
    <div class="empty-state__icon-shell">
      <UiIcon v-if="icon" :name="icon" size="lg" />
    </div>
    <div class="empty-content">
      <p class="empty-title">{{ title }}</p>
      <p v-if="description" class="empty-description">{{ description }}</p>
    </div>
    <div v-if="$slots.actions" class="empty-actions">
      <slot name="actions"></slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import UiIcon from '../ui/UiIcon.vue'

interface Props {
  icon?: string
  title: string
  description?: string
}

withDefaults(defineProps<Props>(), {
  icon: 'inbox'
})
</script>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--ui-space-4);
  padding: var(--ui-space-10) var(--ui-space-6);
  text-align: center;
  background: var(--ui-panel);
  border: 1px dashed var(--ui-border-strong);
  border-radius: var(--ui-radius-lg);
  box-shadow: var(--ui-shadow-sm);
}

.empty-state__icon-shell {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 72px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ui-accent-strong) 12%, transparent);
  color: var(--ui-accent-strong);
}

.empty-content {
  max-width: 420px;
}

.empty-title {
  margin: 0 0 8px 0;
  font-size: 1rem;
  font-weight: 700;
  color: var(--ui-text-soft);
}

.empty-description {
  margin: 0;
  font-size: 0.92rem;
  line-height: 1.6;
  color: var(--ui-text-muted);
}

.empty-actions {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: var(--ui-space-3);
}
</style>
