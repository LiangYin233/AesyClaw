<template>
  <div class="secret-input-wrap">
    <input
      :type="visible ? 'text' : 'password'"
      :value="modelValue"
      class="form-input"
      :placeholder="placeholder"
      @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
    <button type="button" class="btn btn-ghost btn-sm" @click="visible = !visible">
      {{ visible ? '🙈' : '👁️' }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

defineProps<{
  modelValue: string;
  placeholder?: string;
}>();

defineEmits<{
  (e: 'update:modelValue', value: string): void;
}>();

const visible = ref(false);
</script>
