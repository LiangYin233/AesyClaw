<template>
  <button
    class="ui-button"
    :class="buttonClasses"
    :type="type"
    :disabled="disabled || loading"
    v-bind="$attrs"
    @click="handleClick"
  >
    <span v-if="loading" class="ui-button__spinner"></span>
    <UiIcon v-else-if="icon" :name="icon" :size="iconSize" />
    <span v-if="label || $slots.default" class="ui-button__label">
      <slot>{{ label }}</slot>
    </span>
  </button>
</template>

<script setup lang="ts">
import { computed, useSlots } from 'vue'
import UiIcon from './UiIcon.vue'

defineOptions({ inheritAttrs: false })

interface Props {
  label?: string
  icon?: string
  type?: 'button' | 'submit' | 'reset'
  severity?: 'primary' | 'secondary' | 'success' | 'warn' | 'warning' | 'danger' | 'info' | 'contrast'
  outlined?: boolean
  text?: boolean
  link?: boolean
  rounded?: boolean
  loading?: boolean
  disabled?: boolean
  size?: 'small' | 'medium' | 'large'
  fluid?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  label: '',
  icon: '',
  type: 'button',
  severity: 'primary',
  outlined: false,
  text: false,
  link: false,
  rounded: false,
  loading: false,
  disabled: false,
  size: 'medium',
  fluid: false
})

const emit = defineEmits<{ click: [event: MouseEvent] }>()

const normalizedSeverity = computed(() => (props.severity === 'warning' ? 'warn' : props.severity))

const buttonClasses = computed(() => [
  `ui-button--${normalizedSeverity.value}`,
  `ui-button--${props.size}`,
  {
    'ui-button--outlined': props.outlined,
    'ui-button--text': props.text,
    'ui-button--link': props.link,
    'ui-button--rounded': props.rounded,
    'ui-button--fluid': props.fluid,
    'ui-button--icon-only': !props.label && !Object.keys(useSlots()).length
  }
])

const iconSize = computed(() => (props.size === 'large' ? 'lg' : props.size === 'small' ? 'sm' : 'md'))

function handleClick(event: MouseEvent) {
  if (props.disabled || props.loading) {
    event.preventDefault()
    return
  }

  emit('click', event)
}
</script>

<style scoped>
.ui-button {
  --button-accent: var(--ui-accent);
  --button-accent-strong: var(--ui-accent-strong);
  --button-on-accent: var(--ui-on-accent);
  --button-border: transparent;
  appearance: none;
  border: 1px solid var(--button-border);
  background: var(--button-accent);
  color: var(--button-on-accent);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  min-height: 2.75rem;
  padding: 0 1rem;
  border-radius: 0.95rem;
  font: inherit;
  font-weight: 650;
  line-height: 1;
  cursor: pointer;
  transition: transform 0.18s ease, border-color 0.18s ease, background-color 0.18s ease, box-shadow 0.18s ease, color 0.18s ease, opacity 0.18s ease;
  box-shadow: 0 10px 20px color-mix(in srgb, var(--button-accent-strong) 12%, transparent);
}

.ui-button:hover:not(:disabled) {
  transform: translateY(-1px);
  background: var(--button-accent-strong);
}

.ui-button:disabled {
  opacity: 0.56;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.ui-button--small {
  min-height: 2.3rem;
  padding: 0 0.85rem;
  font-size: 0.88rem;
}

.ui-button--large {
  min-height: 3rem;
  padding: 0 1.15rem;
}

.ui-button--rounded {
  border-radius: 999px;
}

.ui-button--fluid {
  width: 100%;
}

.ui-button--text,
.ui-button--link {
  background: transparent;
  border-color: transparent;
  box-shadow: none;
  color: var(--button-accent-strong);
}

.ui-button--text:hover:not(:disabled),
.ui-button--link:hover:not(:disabled) {
  background: color-mix(in srgb, var(--button-accent-strong) 12%, transparent);
}

.ui-button--link {
  padding-left: 0;
  padding-right: 0;
}

.ui-button--outlined {
  background: color-mix(in srgb, var(--ui-panel) 85%, transparent);
  border-color: color-mix(in srgb, var(--button-accent-strong) 24%, transparent);
  color: var(--button-accent-strong);
  box-shadow: none;
}

.ui-button--outlined:hover:not(:disabled) {
  background: color-mix(in srgb, var(--button-accent-strong) 10%, var(--ui-panel));
}

.ui-button--icon-only {
  width: 2.75rem;
  padding: 0;
}

.ui-button__label {
  min-width: 0;
  white-space: nowrap;
}

.ui-button__spinner {
  width: 1rem;
  height: 1rem;
  border-radius: 999px;
  border: 2px solid color-mix(in srgb, currentColor 28%, transparent);
  border-top-color: currentColor;
  animation: ui-spin 0.8s linear infinite;
}

.ui-button--primary { --button-accent: var(--ui-accent); --button-accent-strong: var(--ui-accent-strong); --button-on-accent: var(--ui-on-accent); }
.ui-button--secondary { --button-accent: var(--ui-muted); --button-accent-strong: var(--ui-muted-strong); --button-on-accent: var(--ui-text); }
.ui-button--success { --button-accent: var(--ui-success-soft); --button-accent-strong: var(--ui-success); --button-on-accent: var(--ui-success-text); }
.ui-button--warn { --button-accent: var(--ui-warning-soft); --button-accent-strong: var(--ui-warning); --button-on-accent: var(--ui-warning-text); }
.ui-button--danger { --button-accent: var(--ui-danger-soft); --button-accent-strong: var(--ui-danger); --button-on-accent: var(--ui-danger-text); }
.ui-button--info { --button-accent: var(--ui-info-soft); --button-accent-strong: var(--ui-info); --button-on-accent: var(--ui-info-text); }
.ui-button--contrast { --button-accent: var(--ui-text); --button-accent-strong: var(--ui-text-strong); --button-on-accent: var(--ui-panel); }

@keyframes ui-spin {
  to { transform: rotate(360deg); }
}
</style>
