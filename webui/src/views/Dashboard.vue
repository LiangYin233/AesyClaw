<template>
    <div class="dashboard-page">
        <PageHeader title="仪表盘" subtitle="系统状态与性能监控">
            <template #actions>
                <div class="header-actions">
                    <div class="auto-refresh-control">
                        <InputSwitch v-model="autoRefresh" @change="toggleAutoRefresh" />
                        <span class="auto-refresh-label">自动刷新</span>
                    </div>
                    <Button
                        label="刷新"
                        icon="pi pi-refresh"
                        outlined
                        @click="refreshAll"
                        :loading="refreshing"
                    />
                </div>
            </template>
        </PageHeader>

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

            <!-- Performance Metrics Section -->
            <Card v-if="metricsOverview" class="metrics-card">
                <template #title>
                    <div class="section-header">
                        <h2>性能指标</h2>
                        <span v-if="lastUpdateTime" class="last-update">{{ lastUpdateTime }}</span>
                    </div>
                </template>
                <template #content>
                    <div class="metrics-overview">
                        <div class="metric-stat">
                            <span class="metric-label">指标总数</span>
                            <span class="metric-value">{{ metricsOverview.totalMetrics }}</span>
                        </div>
                        <div class="metric-stat">
                            <span class="metric-label">数据点</span>
                            <span class="metric-value">{{ metricsOverview.totalDataPoints }}</span>
                        </div>
                        <div class="metric-stat">
                            <span class="metric-label">堆内存</span>
                            <span class="metric-value">
                                {{ formatBytes(metricsOverview.memoryUsage.heapUsed) }}
                            </span>
                            <span class="metric-sub">
                                / {{ formatBytes(metricsOverview.memoryUsage.heapTotal) }}
                            </span>
                        </div>
                    </div>

                    <!-- Key Metrics -->
                    <div v-if="keyMetrics.length > 0" class="key-metrics">
                        <h3>关键指标统计</h3>
                        <div class="metrics-grid">
                            <div
                                v-for="metric in keyMetrics"
                                :key="metric.name"
                                class="metric-card"
                            >
                                <div class="metric-header">
                                    <span class="metric-name">{{ formatMetricName(metric.name) }}</span>
                                    <Tag
                                        :value="metric.unit"
                                        severity="secondary"
                                        size="small"
                                    />
                                </div>
                                <div class="metric-stats">
                                    <div class="metric-stat-item">
                                        <span class="stat-label">平均</span>
                                        <span class="stat-value">{{ formatMetricValue(metric.avg, metric.unit) }}</span>
                                    </div>
                                    <div class="metric-stat-item">
                                        <span class="stat-label">P95</span>
                                        <span class="stat-value">{{ formatMetricValue(metric.p95, metric.unit) }}</span>
                                    </div>
                                    <div class="metric-stat-item">
                                        <span class="stat-label">计数</span>
                                        <span class="stat-value">{{ metric.count }}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </template>
            </Card>
        </LoadingContainer>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useSystemStore } from '../stores/system'
import { useApi, type MetricOverview, type MetricStats } from '../composables/useApi'
import { announceToScreenReader } from '../composables/useA11y'
import PageHeader from '../components/common/PageHeader.vue'
import LoadingContainer from '../components/common/LoadingContainer.vue'
import EmptyState from '../components/common/EmptyState.vue'
import Card from 'primevue/card'
import Tag from 'primevue/tag'
import Button from 'primevue/button'
import InputSwitch from 'primevue/inputswitch'

const systemStore = useSystemStore()
const { getMetricOverview, getMetricNames, getMetricStats } = useApi()

const metricsOverview = ref<MetricOverview | null>(null)
const keyMetrics = ref<Array<MetricStats & { name: string; unit: string }>>([])
const autoRefresh = ref(true)
const refreshing = ref(false)
const lastUpdateTime = ref('')

let refreshInterval: number | null = null

// 需要监控的关键指标
const KEY_METRIC_NAMES = [
    'db.query_time',
    'api.request_time',
    'channel.message_sent',
    'plugin.hook_execution',
    'session.load_time',
    'mcp.call_time'
]

function formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400)
    const hours = Math.floor((seconds % 86400) / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    if (days > 0) return `${days}天 ${hours}小时`
    if (hours > 0) return `${hours}小时 ${mins}分钟`
    return `${mins}分钟`
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
}

function formatMetricName(name: string): string {
    const names: Record<string, string> = {
        'db.query_time': '数据库查询',
        'api.request_time': 'API 请求',
        'channel.message_sent': '消息发送',
        'plugin.hook_execution': '插件钩子',
        'session.load_time': 'Session 加载',
        'mcp.call_time': 'MCP 调用'
    }
    return names[name] || name
}

function formatMetricValue(value: number, unit: string): string {
    if (unit === 'ms') {
        return `${value.toFixed(2)}ms`
    } else if (unit === 'count') {
        return value.toString()
    }
    return value.toFixed(2)
}

function formatTime(date: Date): string {
    const hours = date.getHours().toString().padStart(2, '0')
    const minutes = date.getMinutes().toString().padStart(2, '0')
    const seconds = date.getSeconds().toString().padStart(2, '0')
    return `${hours}:${minutes}:${seconds}`
}

async function loadMetrics() {
    try {
        // 加载指标概览
        const overview = await getMetricOverview()
        if (overview) {
            metricsOverview.value = overview
        }

        // 加载关键指标统计
        const names = await getMetricNames()
        if (names) {
            const metrics: Array<MetricStats & { name: string; unit: string }> = []
            for (const name of KEY_METRIC_NAMES) {
                if (names.includes(name)) {
                    const stats = await getMetricStats(name)
                    if (stats) {
                        const unit = name.includes('time') ? 'ms' : 'count'
                        metrics.push({ ...stats, name, unit })
                    }
                }
            }
            keyMetrics.value = metrics
        }

        lastUpdateTime.value = `更新于 ${formatTime(new Date())}`
    } catch (error) {
        console.error('Failed to load metrics:', error)
    }
}

async function refreshAll() {
    refreshing.value = true
    await Promise.all([systemStore.refresh(), loadMetrics()])
    refreshing.value = false
}

function toggleAutoRefresh() {
    if (autoRefresh.value) {
        startAutoRefresh()
    } else {
        stopAutoRefresh()
    }
}

function startAutoRefresh() {
    if (refreshInterval) return
    refreshInterval = window.setInterval(() => {
        refreshAll()
    }, 5000)
}

function stopAutoRefresh() {
    if (refreshInterval) {
        clearInterval(refreshInterval)
        refreshInterval = null
    }
}

onMounted(async () => {
    const success = await systemStore.refresh()
    await loadMetrics()

    if (success) {
        announceToScreenReader('仪表盘数据已加载', 'polite')
    } else {
        announceToScreenReader('仪表盘数据加载失败', 'assertive')
    }

    if (autoRefresh.value) {
        startAutoRefresh()
    }
})

onUnmounted(() => {
    stopAutoRefresh()
})
</script>

<style scoped>
.dashboard-page {
    padding: 0;
}

.header-actions {
    display: flex;
    gap: 8px;
    align-items: center;
}

.auto-refresh-control {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: #f8fafc;
    border-radius: 8px;
    border: 1px solid #e2e8f0;
}

.auto-refresh-label {
    font-size: 13px;
    color: #64748b;
    font-weight: 500;
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

.channels-card,
.metrics-card {
    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
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

.section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
}

.section-header h2 {
    margin: 0;
    font-size: 18px;
}

.last-update {
    font-size: 12px;
    color: #94a3b8;
    font-weight: normal;
}

.metrics-overview {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
    margin-bottom: 24px;
}

.metric-stat {
    padding: 16px;
    background: #f8fafc;
    border-radius: 8px;
    text-align: center;
}

.metric-label {
    display: block;
    font-size: 13px;
    color: #64748b;
    margin-bottom: 8px;
}

.metric-value {
    display: block;
    font-size: 24px;
    font-weight: 700;
    color: #1e293b;
}

.metric-sub {
    display: block;
    font-size: 12px;
    color: #94a3b8;
    margin-top: 4px;
}

.key-metrics h3 {
    font-size: 16px;
    font-weight: 600;
    color: #1e293b;
    margin-bottom: 16px;
}

.metrics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 16px;
}

.metric-card {
    padding: 16px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
}

.metric-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
}

.metric-name {
    font-size: 14px;
    font-weight: 600;
    color: #1e293b;
}

.metric-stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
}

.metric-stat-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.metric-stat-item .stat-label {
    font-size: 11px;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.metric-stat-item .stat-value {
    font-size: 16px;
    font-weight: 600;
    color: #1e293b;
}

@media (max-width: 1024px) {
    .stats-grid {
        grid-template-columns: repeat(2, 1fr);
    }

    .metrics-overview {
        grid-template-columns: repeat(2, 1fr);
    }

    .metrics-grid {
        grid-template-columns: 1fr;
    }
}

@media (max-width: 640px) {
    .stats-grid {
        grid-template-columns: 1fr;
    }

    .metrics-overview {
        grid-template-columns: 1fr;
    }

    .header-actions {
        flex-direction: column;
        width: 100%;
    }

    .auto-refresh-control {
        width: 100%;
        justify-content: space-between;
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
    .auto-refresh-control {
        background: #1e293b;
        border-color: #334155;
    }
    .metric-stat {
        background: #1e293b;
    }
    .metric-value {
        color: #e2e8f0;
    }
    .key-metrics h3 {
        color: #e2e8f0;
    }
    .metric-card {
        background: #1e293b;
        border-color: #334155;
    }
    .metric-name {
        color: #e2e8f0;
    }
    .metric-stat-item .stat-value {
        color: #e2e8f0;
    }
}
</style>
