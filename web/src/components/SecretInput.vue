<template>
  <div class="secret-input-wrap">
    <input
      :type="visible ? 'text' : 'password'"
      v-model="model"
      class="form-input"
      :placeholder="placeholder"
    />
    <button type="button" class="btn btn-ghost btn-sm" @click="visible = !visible">
      {{ visible ? '🙈' : '👁️' }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const model = defineModel<string>({ required: true });

defineProps<{
  placeholder?: string;
}>();

const visible = ref(false);
</script>
