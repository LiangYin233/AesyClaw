<template>
  <div class="system-msg">
    <div class="system-bubble">{{ text }}</div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  text: string;
}>();
</script>

<style scoped>
.system-msg {
  display: flex;
  justify-content: center;
}

.system-bubble {
  max-width: 50%;
  margin: 0 auto;
  padding: 6px 12px;
  border-radius: var(--radius-sm);
  font-family: var(--font-body);
  font-size: 12px;
  text-align: center;
  background: #fef9e7;
  color: var(--color-warning);
  border: 1px solid rgba(201, 163, 90, 0.3);
}
</style>
