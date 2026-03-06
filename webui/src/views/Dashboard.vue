<template>
    <div class="dashboard-page">
        <PageHeader title="仪表盘" subtitle="系统状态概览" />

        <LoadingContainer
            :loading="systemStore.loading && !systemStore.status"
            :error="systemStore.error"
            :on-retry="() => systemStore.refresh()"
        >
            <div class="stats-grid" role="region" aria-label="系统统计">
                <div class="stat-card" role="article" aria-label="版本信息">
                    <div class="stat-content">
                        <span class="stat-label" id="version-label">版本</span>
                        <span class="stat-value" aria-labelledby="version-label">
                            {{ systemStore.version }}
                        </span>
                    </div>
                    <div class="stat-icon" aria-hidden="true">
                        <i class="pi pi-info-circle"></i>
                    </div>
                </div>

                <div class="stat-card" role="article" aria-label="运行时间">
                    <div class="stat-content">
                        <span class="stat-label" id="uptime-label">运行时间</span>
                        <span class="stat-value" aria-labelledby="uptime-label">
                            {{ formatUptime(systemStore.uptime) }}
                        </span>
                    </div>
                    <div class="stat-icon" aria-hidden="true">
                        <i class="pi pi-clock"></i>
                    </div>
                </div>

                <div class="stat-card" role="article" aria-label="会话统计">
                    <div class="stat-content">
                        <span class="stat-label" id="sessions-label">会话数</span>
                        <span class="stat-value" aria-labelledby="sessions-label">
                            {{ systemStore.sessionCount }}
                        </span>
                    </div>
                    <div class="stat-icon" aria-hidden="true">
                        <i class="pi pi-comments"></i>
                    </div>
                </div>

                <div class="stat-card" role="article" aria-label="Agent 状态">
                    <div class="stat-content">
                        <span class="stat-label" id="agent-label">Agent 状态</span>
                        <span
                            class="stat-value"
                            :class="systemStore.agentRunning ? 'text-success' : 'text-danger'"
                            aria-labelledby="agent-label"
                            aria-live="polite"
                        >
                            {{ systemStore.agentRunning ? '运行中' : '已停止' }}
                        </span>
                    </div>
                    <div
                        class="stat-icon"
                        :class="systemStore.agentRunning ? 'icon-success' : 'icon-danger'"
                        aria-hidden="true"
                    >
                        <i :class="systemStore.agentRunning ? 'pi pi-play' : 'pi pi-stop'"></i>
                    </div>
                </div>
            </div>

            <Card class="channels-card">
                <template #title>
                    <h2 id="channels-title">通道状态</h2>
                </template>
                <template #content>
                    <EmptyState
                        v-if="!systemStore.channels || Object.keys(systemStore.channels).length === 0"
                        icon="pi pi-inbox"
                        title="暂无通道数据"
                        description="系统中没有配置任何通道"
                    />
                    <div v-else class="channels-list" role="list" aria-labelledby="channels-title">
                        <div
                            v-for="(value, key) in systemStore.channels"
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
                                    :aria-label="`状态：${value.enabled ? '已启用' : '已禁用'}`"
                                />
                            </div>
                            <Tag
                                v-if="value.connected !== undefined"
                                :value="value.connected ? '已连接' : '未连接'"
                                :severity="value.connected ? 'success' : 'warn'"
                                icon="pi pi-circle-fill"
                                :aria-label="`连接状态：${value.connected ? '已连接' : '未连接'}`"
                            />
                        </div>
                    </div>
                </template>
            </Card>
        </LoadingContainer>
    </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useSystemStore } from '../stores/system'
import { announceToScreenReader } from '../composables/useA11y'
import PageHeader from '../components/common/PageHeader.vue'
import LoadingContainer from '../components/common/LoadingContainer.vue'
import EmptyState from '../components/common/EmptyState.vue'
import Card from 'primevue/card'
import Tag from 'primevue/tag'

const systemStore = useSystemStore()

function formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400)
    const hours = Math.floor((seconds % 86400) / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    if (days > 0) return `${days}天 ${hours}小时`
    if (hours > 0) return `${hours}小时 ${mins}分钟`
    return `${mins}分钟`
}

onMounted(async () => {
    const success = await systemStore.refresh()
    if (success) {
        announceToScreenReader('仪表盘数据已加载', 'polite')
    } else {
        announceToScreenReader('仪表盘数据加载失败', 'assertive')
    }
})
</script>

<style scoped>
.dashboard-page {
    padding: 0;
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

@media (max-width: 1024px) {
    .stats-grid {
        grid-template-columns: repeat(2, 1fr);
    }
}

@media (max-width: 640px) {
    .stats-grid {
        grid-template-columns: 1fr;
    }
}

@media (prefers-color-scheme: dark) {
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
