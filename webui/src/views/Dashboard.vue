<template>
    <div class="dashboard-page">
        <h1>仪表盘</h1>
        
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-content">
                    <span class="stat-label">版本</span>
                    <span class="stat-value">{{ status?.version || '-' }}</span>
                </div>
                <div class="stat-icon">
                    <i class="pi pi-info-circle"></i>
                </div>
            </div>
            
            <div class="stat-card">
                <div class="stat-content">
                    <span class="stat-label">运行时间</span>
                    <span class="stat-value">{{ formatUptime(status?.uptime || 0) }}</span>
                </div>
                <div class="stat-icon">
                    <i class="pi pi-clock"></i>
                </div>
            </div>
            
            <div class="stat-card">
                <div class="stat-content">
                    <span class="stat-label">会话数</span>
                    <span class="stat-value">{{ status?.sessions || 0 }}</span>
                </div>
                <div class="stat-icon">
                    <i class="pi pi-comments"></i>
                </div>
            </div>
            
            <div class="stat-card">
                <div class="stat-content">
                    <span class="stat-label">Agent 状态</span>
                    <span class="stat-value" :class="status?.agentRunning ? 'text-success' : 'text-danger'">
                        {{ status?.agentRunning ? '运行中' : '已停止' }}
                    </span>
                </div>
                <div class="stat-icon" :class="status?.agentRunning ? 'icon-success' : 'icon-danger'">
                    <i :class="status?.agentRunning ? 'pi pi-play' : 'pi pi-stop'"></i>
                </div>
            </div>
        </div>
        
        <Card class="channels-card">
            <template #title>通道状态</template>
            <template #content>
                <div v-if="channels" class="channels-list">
                    <div v-for="(value, key) in channels" :key="key" class="channel-item">
                        <div class="channel-info">
                            <span class="channel-name">{{ key }}</span>
                            <Tag v-if="value.enabled !== undefined" 
                                 :value="value.enabled ? '已启用' : '已禁用'" 
                                 :severity="value.enabled ? 'success' : 'secondary'" />
                        </div>
                        <Tag v-if="value.connected !== undefined" 
                             :value="value.connected ? '已连接' : '未连接'" 
                             :severity="value.connected ? 'success' : 'warn'" 
                             icon="pi pi-circle-fill" />
                    </div>
                </div>
                <div v-else class="loading">
                    <ProgressSpinner />
                </div>
            </template>
        </Card>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useApi } from '../composables/useApi'
import Card from 'primevue/card'
import Tag from 'primevue/tag'
import ProgressSpinner from 'primevue/progressspinner'

const { getStatus, getChannels } = useApi()
const status = ref<any>(null)
const channels = ref<any>(null)

function formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400)
    const hours = Math.floor((seconds % 86400) / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    if (days > 0) return `${days}天 ${hours}小时`
    if (hours > 0) return `${hours}小时 ${mins}分钟`
    return `${mins}分钟`
}

onMounted(async () => {
    status.value = await getStatus()
    channels.value = await getChannels()
})
</script>

<style scoped>
.dashboard-page {
    padding: 24px;
}

.dashboard-page h1 {
    margin: 0 0 24px 0;
    font-size: 24px;
    font-weight: bold;
    color: #1e293b;
}

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
    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
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

.channels-card {
    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
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
    padding: 12px;
    background: #f8fafc;
    border-radius: 8px;
}

.channel-info {
    display: flex;
    align-items: center;
    gap: 12px;
}

.channel-name {
    font-weight: 500;
    color: #334155;
}

.loading {
    display: flex;
    justify-content: center;
    padding: 24px;
}

@media (prefers-color-scheme: dark) {
    .dashboard-page h1 {
        color: #f1f5f9;
    }
    .stat-card {
        background: #1e293b;
        border-color: #334155;
    }
    .stat-label {
        color: #94a3b8;
    }
    .stat-value {
        color: #f1f5f9;
    }
    .stat-icon {
        background: #334155;
        color: #94a3b8;
    }
    .channel-item {
        background: #1e293b;
    }
    .channel-name {
        color: #e2e8f0;
    }
}
</style>
