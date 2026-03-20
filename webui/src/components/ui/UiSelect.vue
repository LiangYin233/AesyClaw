<template>
  <select
    class="ui-select"
    :value="resolvedValue"
    v-bind="$attrs"
    @change="handleChange"
  >
    <option v-if="placeholder || showClear" value="">
      {{ placeholder || '请选择' }}
    </option>
    <option v-for="option in normalizedOptions" :key="option.key" :value="option.value">
      {{ option.label }}
    </option>
  </select>
</template>

<script setup lang="ts">
import { computed } from 'vue'

defineOptions({ inheritAttrs: false })

interface Props {
  modelValue?: string | number | null
  options?: any[]
  optionLabel?: string
  optionValue?: string
  placeholder?: string
  showClear?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: '',
  options: () => [],
  optionLabel: 'label',
  optionValue: 'value',
  placeholder: '',
  showClear: false
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  change: [value: string]
}>()

const normalizedOptions = computed(() =>
  props.options.map((option, index) => {
    if (typeof option === 'string' || typeof option === 'number') {
      return { key: `${option}-${index}`, label: String(option), value: String(option) }
    }

    return {
      key: `${option?.[props.optionValue] ?? index}`,
      label: String(option?.[props.optionLabel] ?? ''),
      value: String(option?.[props.optionValue] ?? '')
    }
  })
)

const resolvedValue = computed(() => String(props.modelValue ?? ''))

function handleChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  emit('update:modelValue', value)
  emit('change', value)
}
</script>

<style scoped>
.ui-select {
  width: 100%;
  min-height: 2.8rem;
  padding: 0 2.4rem 0 0.9rem;
  border-radius: 0.95rem;
  border: 1px solid var(--ui-border);
  background:
    linear-gradient(45deg, transparent 50%, var(--ui-text-muted) 50%) calc(100% - 18px) calc(50% - 2px) / 7px 7px no-repeat,
    linear-gradient(135deg, var(--ui-text-muted) 50%, transparent 50%) calc(100% - 13px) calc(50% - 2px) / 7px 7px no-repeat,
    var(--ui-input-bg);
  color: var(--ui-text);
  font: inherit;
  appearance: none;
  outline: none;
}

.ui-select:focus {
  border-color: color-mix(in srgb, var(--ui-accent) 45%, var(--ui-border));
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--ui-accent) 12%, transparent);
}
</style>
