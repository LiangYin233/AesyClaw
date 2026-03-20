<template>
  <button
    type="button"
    class="ui-switch"
    :class="{ 'ui-switch--active': modelValue }"
    :aria-pressed="modelValue"
    v-bind="$attrs"
    @click="toggle"
  >
    <span class="ui-switch__track">
      <span class="ui-switch__thumb"></span>
    </span>
    <span v-if="showLabels" class="ui-switch__label">{{ modelValue ? onLabel : offLabel }}</span>
  </button>
</template>

<script setup lang="ts">
defineOptions({ inheritAttrs: false })

interface Props {
  modelValue?: boolean
  onLabel?: string
  offLabel?: string
  showLabels?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: false,
  onLabel: '开启',
  offLabel: '关闭',
  showLabels: false
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  change: [value: boolean]
}>()

function toggle() {
  const nextValue = !props.modelValue
  emit('update:modelValue', nextValue)
  emit('change', nextValue)
}
</script>

<style scoped>
.ui-switch {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  background: transparent;
  border: none;
  color: inherit;
  cursor: pointer;
  padding: 0;
}

.ui-switch__track {
  width: 2.75rem;
  height: 1.6rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ui-text) 14%, transparent);
  padding: 0.15rem;
  transition: background-color 0.18s ease;
}

.ui-switch__thumb {
  display: block;
  width: 1.3rem;
  height: 1.3rem;
  border-radius: 999px;
  background: white;
  box-shadow: 0 6px 14px rgba(15, 23, 42, 0.22);
  transform: translateX(0);
  transition: transform 0.18s ease;
}

.ui-switch--active .ui-switch__track {
  background: var(--ui-accent);
}

.ui-switch--active .ui-switch__thumb {
  transform: translateX(1.15rem);
}

.ui-switch__label {
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--ui-text-soft);
}
</style>
