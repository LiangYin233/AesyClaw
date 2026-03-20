<template>
  <section class="ui-card" :class="{ 'ui-card--interactive': interactive }">
    <header v-if="$slots.title || $slots.subtitle || title || subtitle" class="ui-card__header">
      <div class="ui-card__heading">
        <div v-if="$slots.title || title" class="ui-card__title">
          <slot name="title">{{ title }}</slot>
        </div>
        <div v-if="$slots.subtitle || subtitle" class="ui-card__subtitle">
          <slot name="subtitle">{{ subtitle }}</slot>
        </div>
      </div>
    </header>
    <div v-if="$slots.default || $slots.content" class="ui-card__content">
      <slot name="content">
        <slot></slot>
      </slot>
    </div>
    <footer v-if="$slots.footer" class="ui-card__footer">
      <slot name="footer"></slot>
    </footer>
  </section>
</template>

<script setup lang="ts">
interface Props {
  title?: string
  subtitle?: string
  interactive?: boolean
}

withDefaults(defineProps<Props>(), {
  title: '',
  subtitle: '',
  interactive: false
})
</script>

<style scoped>
.ui-card {
  border-radius: var(--ui-radius-lg);
  border: 1px solid var(--ui-border);
  background: var(--ui-panel);
  box-shadow: var(--ui-shadow-sm);
  backdrop-filter: blur(18px);
  overflow: hidden;
}

.ui-card--interactive {
  transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
}

.ui-card--interactive:hover {
  transform: translateY(-2px);
  box-shadow: var(--ui-shadow-md);
  border-color: color-mix(in srgb, var(--ui-accent) 18%, var(--ui-border));
}

.ui-card__header,
.ui-card__content,
.ui-card__footer {
  padding: 1.2rem 1.25rem;
}

.ui-card__header {
  padding-bottom: 0.85rem;
}

.ui-card__content {
  padding-top: 0;
  color: var(--ui-text-soft);
}

.ui-card__footer {
  border-top: 1px solid var(--ui-border-subtle);
  background: var(--ui-panel-alt);
}

.ui-card__title {
  font-size: 1rem;
  font-weight: 700;
  color: var(--ui-text-strong);
}

.ui-card__subtitle {
  margin-top: 0.35rem;
  font-size: 0.86rem;
  line-height: 1.5;
  color: var(--ui-text-muted);
}
</style>
