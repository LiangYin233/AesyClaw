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
          :aria-label="buildAriaLabel(key, value)"
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
            v-if="getConnectedState(value) !== undefined"
            :value="getConnectedState(value) ? '已连接' : '未连接'"
            :severity="getConnectedState(value) ? 'success' : 'warn'"
            icon="pi pi-circle-fill"
          />
        </div>
      </div>
    </template>
  </Card>
</template>

<script setup lang="ts">
import type { ChannelStatus } from '../../types/api'
import Card from 'primevue/card'
import Tag from 'primevue/tag'
import EmptyState from '../common/EmptyState.vue'

defineProps<{ channels: Record<string, ChannelStatus> | null }>()

function getConnectedState(value: ChannelStatus): boolean | undefined {
  return value.connected ?? value.running
}

function buildAriaLabel(key: string, value: ChannelStatus): string {
  const enabledLabel = value.enabled === undefined ? '启用状态未知' : value.enabled ? '已启用' : '已禁用'
  const connected = getConnectedState(value)
  const connectedLabel = connected === undefined ? '连接状态未知' : connected ? '已连接' : '未连接'
  return `通道 ${key}，${enabledLabel}，${connectedLabel}`
}
</script>

<style scoped>
.channels-card {
  box-shadow: var(--ui-shadow-sm);
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
  background: var(--ui-surface-muted);
  border-radius: 8px;
  border: 1px solid var(--ui-border);
}

.channel-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.channel-name {
  font-size: 16px;
  font-weight: 500;
  color: var(--ui-text);
}
</style>
