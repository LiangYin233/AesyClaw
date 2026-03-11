<template>
  <Card class="channels-card">
    <template #title><h2 id="channels-title">通道状态</h2></template>
    <template #content>
      <EmptyState
        v-if="!channels || Object.keys(channels).length === 0"
        icon="pi pi-inbox"
        title="暂无通道数据"
        description="系统中没有配置任何通道"
      />
      <div v-else class="channels-list" role="list" aria-labelledby="channels-title">
        <div
          v-for="(value, key) in channels"
          :key="key"
          class="channel-item"
          role="listitem"
          :aria-label="`通道 ${key}，${value.enabled ? '已启用' : '已禁用'}，${value.connected ? '已连接' : '未连接'}`"
        >
          <div class="channel-info">
            <span class="channel-name">{{ key }}</span>
            <Tag
              v-if="value.enabled !== undefined"
              :value="value.enabled ? '已启用' : '已禁用'"
              :severity="value.enabled ? 'success' : 'secondary'"
            />
          </div>
          <Tag
            v-if="value.connected !== undefined"
            :value="value.connected ? '已连接' : '未连接'"
            :severity="value.connected ? 'success' : 'warn'"
            icon="pi pi-circle-fill"
          />
        </div>
      </div>
    </template>
  </Card>
</template>

<script setup lang="ts">
import Card from 'primevue/card'
import Tag from 'primevue/tag'
import EmptyState from '../common/EmptyState.vue'

defineProps<{ channels: Record<string, any> | null }>()
</script>

<style scoped>
.channels-card {
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  margin-bottom: 24px;
}

.channels-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.channel-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  background: #f8fafc;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
}

.channel-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.channel-name {
  font-size: 16px;
  font-weight: 500;
  color: #1e293b;
}
</style>
