<template>
  <Card v-if="overview" class="metrics-card">
    <template #title><h2>性能指标概览</h2></template>
    <template #content>
      <div class="metrics-overview">
        <div class="metric-stat">
          <span class="metric-label">指标总数</span>
          <span class="metric-value">{{ overview.totalMetrics }}</span>
        </div>
        <div class="metric-stat">
          <span class="metric-label">数据点</span>
          <span class="metric-value">{{ overview.totalDataPoints }}</span>
        </div>
        <div class="metric-stat">
          <span class="metric-label">堆内存</span>
          <span class="metric-value">{{ formatBytes(overview.memoryUsage.heapUsed) }}</span>
          <span class="metric-sub">/ {{ formatBytes(overview.memoryUsage.heapTotal) }}</span>
        </div>
        <div class="metric-stat">
          <span class="metric-label">RSS 内存</span>
          <span class="metric-value">{{ formatBytes(overview.memoryUsage.rss) }}</span>
        </div>
      </div>
    </template>
  </Card>

  <Card v-if="memory" class="memory-card">
    <template #title>内存使用详情</template>
    <template #content>
      <div class="memory-grid">
        <div class="memory-item"><span class="memory-label">堆内存已用:</span><span class="memory-value">{{ formatBytes(memory.heapUsed) }}</span></div>
        <div class="memory-item"><span class="memory-label">堆内存总量:</span><span class="memory-value">{{ formatBytes(memory.heapTotal) }}</span></div>
        <div class="memory-item"><span class="memory-label">外部内存:</span><span class="memory-value">{{ formatBytes(memory.external) }}</span></div>
        <div class="memory-item"><span class="memory-label">RSS:</span><span class="memory-value">{{ formatBytes(memory.rss) }}</span></div>
        <div class="memory-item" v-if="memory.arrayBuffers"><span class="memory-label">ArrayBuffers:</span><span class="memory-value">{{ formatBytes(memory.arrayBuffers) }}</span></div>
      </div>
      <div class="memory-bar"><div class="memory-bar-fill" :style="{ width: `${(memory.heapUsed / memory.heapTotal) * 100}%` }"></div></div>
      <div class="memory-percentage">{{ ((memory.heapUsed / memory.heapTotal) * 100).toFixed(1) }}% 已使用</div>
    </template>
  </Card>

  <Card v-if="keyMetrics.length > 0" class="key-metrics-card">
    <template #title>关键指标统计</template>
    <template #content>
      <div class="metrics-grid">
        <div v-for="metric in keyMetrics" :key="metric.name" class="metric-card">
          <div class="metric-header">
            <span class="metric-name">{{ formatMetricName(metric.name) }}</span>
            <Tag :value="metric.unit" severity="secondary" size="small" />
          </div>
          <div class="metric-stats">
            <div class="metric-stat-item"><span class="stat-label">平均</span><span class="stat-value">{{ formatMetricValue(metric.mean, metric.unit) }}</span></div>
            <div class="metric-stat-item"><span class="stat-label">P95</span><span class="stat-value">{{ formatMetricValue(metric.p95, metric.unit) }}</span></div>
            <div class="metric-stat-item"><span class="stat-label">计数</span><span class="stat-value">{{ metric.count }}</span></div>
          </div>
        </div>
      </div>
    </template>
  </Card>
</template>

<script setup lang="ts">
import Card from 'primevue/card'
import Tag from 'primevue/tag'
import type { MetricOverview, MetricStats, MemoryUsage } from '../../types/api'

defineProps<{
  overview: MetricOverview | null
  memory: MemoryUsage | null
  keyMetrics: Array<MetricStats & { name: string; unit: string }>
  formatBytes: (bytes: number) => string
  formatMetricName: (name: string) => string
  formatMetricValue: (value: number | undefined, unit: string) => string
}>()
</script>

<style scoped>
.metrics-card,
.memory-card,
.key-metrics-card {
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  margin-bottom: 24px;
}

.metrics-overview {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}

.metric-stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.metric-label,
.memory-label,
.stat-label {
  font-size: 13px;
  color: #64748b;
}

.metric-value,
.memory-value,
.stat-value {
  font-size: 20px;
  font-weight: 700;
  color: #1e293b;
}

.metric-sub {
  font-size: 12px;
  color: #94a3b8;
}

.memory-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.memory-item {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  background: #f8fafc;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
}

.memory-bar {
  width: 100%;
  height: 10px;
  background: #e2e8f0;
  border-radius: 999px;
  overflow: hidden;
  margin-top: 16px;
}

.memory-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #3b82f6 0%, #22c55e 100%);
}

.memory-percentage {
  margin-top: 8px;
  color: #64748b;
  font-size: 13px;
  text-align: right;
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.metric-card {
  padding: 16px;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  background: #f8fafc;
}

.metric-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.metric-name {
  font-size: 14px;
  font-weight: 600;
  color: #1e293b;
}

.metric-stats {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.metric-stat-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

@media (max-width: 1024px) {
  .metrics-overview,
  .metrics-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .metrics-overview,
  .memory-grid,
  .metrics-grid {
    grid-template-columns: 1fr;
  }
}
</style>
