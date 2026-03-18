<template>
  <div class="unauthorized-page">
    <div class="unauthorized-card">
      <i class="pi pi-lock unauthorized-icon" aria-hidden="true"></i>
      <h1>访问受限</h1>
      <p>{{ message }}</p>
      <code>http://host:5173/?token=YOUR_TOKEN</code>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()

const message = computed(() => {
  return route.query.reason === 'invalid'
    ? 'token 无效，请使用带正确 ?token= 的链接访问 WebUI。'
    : '缺少 token，请使用带 ?token= 的链接访问 WebUI。'
})
</script>

<style scoped>
.unauthorized-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--ui-surface-code) 0%, var(--ui-surface-muted) 100%);
  padding: 24px;
}

.unauthorized-card {
  width: min(480px, 100%);
  background: var(--ui-surface-strong);
  border: 1px solid var(--ui-border);
  border-radius: 16px;
  padding: 32px;
  box-shadow: var(--ui-shadow-md);
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.unauthorized-icon {
  font-size: 40px;
  color: var(--ui-primary);
}

h1 {
  margin: 0;
  font-size: 28px;
  color: var(--ui-text);
}

p {
  margin: 0;
  color: var(--ui-text-soft);
  line-height: 1.6;
}

code {
  background: var(--ui-surface-code);
  color: var(--ui-primary-text);
  padding: 12px;
  border-radius: 8px;
  font-size: 13px;
  word-break: break-all;
}
</style>
