<template>
  <section class="page-section surface-panel">
    <header v-if="title || subtitle || $slots.actions" class="page-section__header">
      <div class="page-section__heading">
        <h2 v-if="title" class="page-section__title">{{ title }}</h2>
        <p v-if="subtitle" class="page-section__subtitle">{{ subtitle }}</p>
      </div>
      <div v-if="$slots.actions" class="page-section__actions">
        <slot name="actions"></slot>
      </div>
    </header>
    <div class="page-section__content">
      <slot></slot>
    </div>
  </section>
</template>

<script setup lang="ts">
interface Props {
  title?: string
  subtitle?: string
}

defineProps<Props>()
</script>

<style scoped>
.page-section {
  padding: var(--ui-space-5);
}

.page-section__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--ui-space-4);
  margin-bottom: var(--ui-space-5);
}

.page-section__heading {
  min-width: 0;
  flex: 1;
}

.page-section__title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--ui-text);
}

.page-section__subtitle {
  margin: 6px 0 0 0;
  font-size: 0.92rem;
  line-height: 1.5;
  color: var(--ui-text-muted);
}

.page-section__actions {
  display: flex;
  align-items: center;
  gap: var(--ui-space-3);
  flex-wrap: wrap;
}

.page-section__content {
  min-width: 0;
}

@media (max-width: 768px) {
  .page-section {
    padding: var(--ui-space-4);
  }

  .page-section__header {
    flex-direction: column;
    align-items: stretch;
    margin-bottom: var(--ui-space-4);
  }
}
</style>
