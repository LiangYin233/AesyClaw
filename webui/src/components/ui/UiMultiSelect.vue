<template>
  <details class="ui-multiselect">
    <summary class="ui-multiselect__summary">
      <span>{{ summaryText }}</span>
    </summary>
    <div class="ui-multiselect__panel">
      <label v-for="option in normalizedOptions" :key="option.key" class="ui-multiselect__option">
        <input
          type="checkbox"
          :checked="selectedValues.includes(option.value)"
          @change="toggleOption(option.value)"
        />
        <span>{{ option.label }}</span>
      </label>
    </div>
  </details>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  modelValue?: string[]
  options?: Array<string | { label: string; value: string }>
  optionLabel?: string
  optionValue?: string
  placeholder?: string
  maxSelectedLabels?: number
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: () => [],
  options: () => [],
  optionLabel: 'label',
  optionValue: 'value',
  placeholder: '请选择',
  maxSelectedLabels: 6
})

const emit = defineEmits<{
  'update:modelValue': [value: string[]]
  change: [value: string[]]
}>()

const normalizedOptions = computed(() =>
  props.options.map((option, index) => {
    if (typeof option === 'string') {
      return { key: `${option}-${index}`, label: option, value: option }
    }

    const record = option as Record<string, string>
    return {
      key: `${record?.[props.optionValue] ?? index}`,
      label: record?.[props.optionLabel] ?? '',
      value: record?.[props.optionValue] ?? ''
    }
  })
)

const selectedValues = computed(() => props.modelValue)

const summaryText = computed(() => {
  if (selectedValues.value.length === 0) {
    return props.placeholder
  }

  if (selectedValues.value.length <= props.maxSelectedLabels) {
    return selectedValues.value.join('、')
  }

  return `已选择 ${selectedValues.value.length} 项`
})

function toggleOption(value: string) {
  const nextValues = selectedValues.value.includes(value)
    ? selectedValues.value.filter((item) => item !== value)
    : [...selectedValues.value, value]

  emit('update:modelValue', nextValues)
  emit('change', nextValues)
}
</script>

<style scoped>
.ui-multiselect {
  position: relative;
}

.ui-multiselect__summary {
  list-style: none;
  cursor: pointer;
  min-height: 2.8rem;
  padding: 0.8rem 0.9rem;
  border-radius: 0.95rem;
  border: 1px solid var(--ui-border);
  background: var(--ui-input-bg);
  color: var(--ui-text);
}

.ui-multiselect__summary::-webkit-details-marker {
  display: none;
}

.ui-multiselect[open] .ui-multiselect__summary {
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
}

.ui-multiselect__panel {
  display: grid;
  gap: 0.55rem;
  padding: 0.9rem;
  border: 1px solid var(--ui-border);
  border-top: none;
  border-bottom-left-radius: 0.95rem;
  border-bottom-right-radius: 0.95rem;
  background: var(--ui-panel-strong);
}

.ui-multiselect__option {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  color: var(--ui-text-soft);
}
</style>
