<template>
  <div class="empty-state" role="status">
    <i v-if="icon" :class="icon" class="empty-icon" aria-hidden="true"></i>
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
interface Props {
  icon?: string
  title: string
  description?: string
}

withDefaults(defineProps<Props>(), {
  icon: 'pi pi-inbox'
})
</script>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  text-align: center;
  color: #94a3b8;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
  opacity: 0.5;
}

.empty-content {
  max-width: 400px;
}

.empty-title {
  margin: 0 0 8px 0;
  font-size: 16px;
  font-weight: 500;
  color: #64748b;
}

.empty-description {
  margin: 0;
  font-size: 14px;
  color: #94a3b8;
}

.empty-actions {
  margin-top: 16px;
  display: flex;
  gap: 8px;
}

@media (prefers-color-scheme: dark) {
  .empty-title {
    color: #94a3b8;
  }

  .empty-description {
    color: #64748b;
  }
}
</style>
