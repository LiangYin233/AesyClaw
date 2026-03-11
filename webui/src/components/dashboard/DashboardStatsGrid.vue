<template>
  <div class="stats-grid" role="region" aria-label="系统统计">
    <div class="stat-card" role="article" aria-label="版本信息">
      <div class="stat-content">
        <span class="stat-label" id="version-label">版本</span>
        <span class="stat-value" aria-labelledby="version-label">{{ version }}</span>
      </div>
      <div class="stat-icon" aria-hidden="true"><i class="pi pi-info-circle"></i></div>
    </div>

    <div class="stat-card" role="article" aria-label="运行时间">
      <div class="stat-content">
        <span class="stat-label" id="uptime-label">运行时间</span>
        <span class="stat-value" aria-labelledby="uptime-label">{{ formatUptime(uptime) }}</span>
      </div>
      <div class="stat-icon" aria-hidden="true"><i class="pi pi-clock"></i></div>
    </div>

    <div class="stat-card" role="article" aria-label="会话统计">
      <div class="stat-content">
        <span class="stat-label" id="sessions-label">会话数</span>
        <span class="stat-value" aria-labelledby="sessions-label">{{ sessionCount }}</span>
      </div>
      <div class="stat-icon" aria-hidden="true"><i class="pi pi-comments"></i></div>
    </div>

    <div class="stat-card" role="article" aria-label="Agent 状态">
      <div class="stat-content">
        <span class="stat-label" id="agent-label">Agent 状态</span>
        <span class="stat-value" :class="agentRunning ? 'text-success' : 'text-danger'" aria-labelledby="agent-label" aria-live="polite">
          {{ agentRunning ? '运行中' : '已停止' }}
        </span>
      </div>
      <div class="stat-icon" :class="agentRunning ? 'icon-success' : 'icon-danger'" aria-hidden="true">
        <i :class="agentRunning ? 'pi pi-play' : 'pi pi-stop'"></i>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  version: string
  uptime: number
  sessionCount: number
  agentRunning: boolean
  formatUptime: (seconds: number) => string
}>()
</script>

<style scoped>
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}

.stat-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.stat-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-label {
  font-size: 14px;
  color: #64748b;
}

.stat-value {
  font-size: 24px;
  font-weight: bold;
  color: #1e293b;
}

.stat-icon {
  width: 48px;
  height: 48px;
  border-radius: 8px;
  background: #f1f5f9;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  color: #64748b;
}

.icon-success {
  background: #dcfce7;
  color: #16a34a;
}

.icon-danger {
  background: #fee2e2;
  color: #dc2626;
}

.text-success {
  color: #16a34a;
}

.text-danger {
  color: #dc2626;
}

@media (max-width: 1024px) {
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 640px) {
  .stats-grid {
    grid-template-columns: 1fr;
  }

  .stat-card {
    padding: 16px;
  }

  .stat-value {
    font-size: 20px;
  }
}
</style>
