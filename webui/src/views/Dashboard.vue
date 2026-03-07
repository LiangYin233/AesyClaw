<template>
    <div class="dashboard-page">
        <PageHeader title="仪表盘" subtitle="系统状态与性能监控">
            <template #actions>
                <div class="header-actions">
                    <div class="auto-refresh-control">
                        <InputSwitch v-model="autoRefresh" @change="toggleAutoRefresh" />
                        <span class="auto-refresh-label">自动刷新</span>
                        <span v-if="lastUpdateTime" class="last-update">{{ lastUpdateTime }}</span>
                    </div>
                    <Button
                        label="刷新"
                        icon="pi pi-refresh"
                        outlined
                        @click="refreshAll"
                        :loading="refreshing"
                    />
                    <Button label="导出" icon="pi pi-download" outlined @click="handleExport" />
                    <Button label="清空" icon="pi pi-trash" severity="danger" outlined @click="confirmClear" />
                </div>
            </template>
        </PageHeader>

        <LoadingContainer
            :loading="initialLoading"
            :error="systemStore.error"
            :on-retry="handleRetry"
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
                    <h2>性能指标概览</h2>
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
                        <div class="metric-stat">
                            <span class="metric-label">RSS 内存</span>
                            <span class="metric-value">
                                {{ formatBytes(metricsOverview.memoryUsage.rss) }}
                            </span>
                        </div>
                    </div>
                </template>
            </Card>

            <!-- Memory Usage Details -->
            <Card v-if="memory" class="memory-card">
                <template #title>内存使用详情</template>
                <template #content>
                    <div class="memory-grid">
                        <div class="memory-item">
                            <span class="memory-label">堆内存已用:</span>
                            <span class="memory-value">{{ formatBytes(memory.heapUsed) }}</span>
                        </div>
                        <div class="memory-item">
                            <span class="memory-label">堆内存总量:</span>
                            <span class="memory-value">{{ formatBytes(memory.heapTotal) }}</span>
                        </div>
                        <div class="memory-item">
                            <span class="memory-label">外部内存:</span>
                            <span class="memory-value">{{ formatBytes(memory.external) }}</span>
                        </div>
                        <div class="memory-item">
                            <span class="memory-label">RSS:</span>
                            <span class="memory-value">{{ formatBytes(memory.rss) }}</span>
                        </div>
                        <div class="memory-item" v-if="memory.arrayBuffers">
                            <span class="memory-label">ArrayBuffers:</span>
                            <span class="memory-value">{{ formatBytes(memory.arrayBuffers) }}</span>
                        </div>
                    </div>
                    <div class="memory-bar">
                        <div
                            class="memory-bar-fill"
                            :style="{ width: `${(memory.heapUsed / memory.heapTotal) * 100}%` }"
                        ></div>
                    </div>
                    <div class="memory-percentage">
                        {{ ((memory.heapUsed / memory.heapTotal) * 100).toFixed(1) }}% 已使用
                    </div>
                </template>
            </Card>

            <!-- Key Metrics -->
            <Card v-if="keyMetrics.length > 0" class="key-metrics-card">
                <template #title>关键指标统计</template>
                <template #content>
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
                                    <span class="stat-value">{{ formatMetricValue(metric.mean, metric.unit) }}</span>
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
                </template>
            </Card>

            <!-- All Metrics List -->
            <Card v-if="metricNames.length > 0" class="metrics-list-card">
                <template #title>
                    <div class="metrics-header">
                        <span>所有指标</span>
                        <InputText
                            v-model="searchQuery"
                            placeholder="搜索指标..."
                            class="search-input"
                        >
                            <template #prefix>
                                <i class="pi pi-search"></i>
                            </template>
                        </InputText>
                    </div>
                </template>
                <template #content>
                    <div v-if="filteredMetrics.length > 0" class="metrics-list">
                        <div
                            v-for="name in filteredMetrics"
                            :key="name"
                            class="metric-item"
                            @click="viewMetricDetails(name)"
                        >
                            <div class="metric-item-name">{{ name }}</div>
                            <i class="pi pi-chevron-right"></i>
                        </div>
                    </div>
                    <Message v-else severity="info" :closable="false">
                        {{ searchQuery ? '未找到匹配的指标' : '暂无指标数据' }}
                    </Message>
                </template>
            </Card>
        </LoadingContainer>

        <!-- Metric Details Dialog -->
        <Dialog v-model:visible="showDetailsDialog" header="指标详情" :style="{ width: '600px' }" modal>
            <div v-if="selectedMetric">
                <div class="details-section">
                    <h3>{{ selectedMetric.name }}</h3>
                    <div class="stats-grid">
                        <div class="stat-item">
                            <span class="stat-label">计数:</span>
                            <span class="stat-value">{{ selectedMetric.count }}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">总和:</span>
                            <span class="stat-value">{{ selectedMetric.sum.toFixed(2) }}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">最小值:</span>
                            <span class="stat-value">{{ selectedMetric.min.toFixed(2) }}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">最大值:</span>
                            <span class="stat-value">{{ selectedMetric.max.toFixed(2) }}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">平均值:</span>
                            <span class="stat-value">{{ selectedMetric.mean.toFixed(2) }}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">P50:</span>
                            <span class="stat-value">{{ selectedMetric.p50.toFixed(2) }}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">P95:</span>
                            <span class="stat-value">{{ selectedMetric.p95.toFixed(2) }}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">P99:</span>
                            <span class="stat-value">{{ selectedMetric.p99.toFixed(2) }}</span>
                        </div>
                    </div>
                </div>
            </div>
            <template #footer>
                <Button label="关闭" @click="showDetailsDialog = false" />
            </template>
        </Dialog>

        <!-- Clear Confirmation Dialog -->
        <Dialog v-model:visible="showClearDialog" header="确认清空" :style="{ width: '450px' }" modal>
            <div class="confirm-content">
                <i class="pi pi-exclamation-triangle" style="font-size: 2rem; color: var(--red-500)"></i>
                <span>确定要清空所有指标数据吗？此操作无法撤销。</span>
            </div>
            <template #footer>
                <Button label="取消" text @click="showClearDialog = false" />
                <Button label="清空" severity="danger" @click="clearData" :loading="clearing" />
            </template>
        </Dialog>

        <Toast />
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useSystemStore } from '../stores/system'
import { useApi, type MetricOverview, type MetricStats, type MemoryUsage } from '../composables/useApi'
import { announceToScreenReader } from '../composables/useA11y'
import { useToast } from 'primevue/usetoast'
import PageHeader from '../components/common/PageHeader.vue'
import LoadingContainer from '../components/common/LoadingContainer.vue'
import EmptyState from '../components/common/EmptyState.vue'
import Card from 'primevue/card'
import Tag from 'primevue/tag'
import Button from 'primevue/button'
import InputSwitch from 'primevue/inputswitch'
import InputText from 'primevue/inputtext'
import Dialog from 'primevue/dialog'
import Message from 'primevue/message'
import Toast from 'primevue/toast'

const systemStore = useSystemStore()
const {
    getMetricOverview,
    getMetricNames,
    getMetricStats,
    getMemoryUsage,
    exportMetrics,
    clearMetrics
} = useApi()
const toast = useToast()

const metricsOverview = ref<MetricOverview | null>(null)
const memory = ref<MemoryUsage | null>(null)
const metricNames = ref<string[]>([])
const keyMetrics = ref<Array<MetricStats & { name: string; unit: string }>>([])
const autoRefresh = ref(true)
const refreshing = ref(false)
const clearing = ref(false)
const lastUpdateTime = ref('')
const searchQuery = ref('')
const showDetailsDialog = ref(false)
const showClearDialog = ref(false)
const selectedMetric = ref<MetricStats | null>(null)
const isMounted = ref(false)
const initialLoading = ref(true)

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

const filteredMetrics = computed(() => {
    if (!searchQuery.value) return metricNames.value
    const query = searchQuery.value.toLowerCase()
    return metricNames.value.filter(name => name.toLowerCase().includes(query))
})

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

function formatMetricValue(value: number | undefined, unit: string): string {
    if (value === undefined || value === null || isNaN(value)) {
        return '-'
    }
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
    if (!isMounted.value) return

    try {
        const [overview, memoryData, names] = await Promise.all([
            getMetricOverview(),
            getMemoryUsage(),
            getMetricNames()
        ])

        if (!isMounted.value) return

        if (overview) {
            metricsOverview.value = overview
        }

        if (memoryData) {
            memory.value = memoryData
        }

        if (names) {
            metricNames.value = names

            const metrics: Array<MetricStats & { name: string; unit: string }> = []
            for (const name of KEY_METRIC_NAMES) {
                if (names.includes(name)) {
                    const stats = await getMetricStats(name)
                    if (!isMounted.value) return
                    if (stats &&
                        typeof stats.mean === 'number' &&
                        typeof stats.p95 === 'number' &&
                        typeof stats.count === 'number') {
                        const unit = name.includes('time') ? 'ms' : 'count'
                        metrics.push({ ...stats, name, unit })
                    }
                }
            }

            if (!isMounted.value) return
            keyMetrics.value = metrics
        }

        lastUpdateTime.value = `更新于 ${formatTime(new Date())}`
    } catch (error) {
        console.error('Failed to load metrics:', error)
    }
}

async function refreshAll() {
    if (refreshing.value || !isMounted.value) return

    refreshing.value = true
    try {
        await systemStore.refresh()
        if (isMounted.value) {
            await loadMetrics()
        }
    } catch (error) {
        console.error('Refresh failed:', error)
    } finally {
        if (isMounted.value) {
            refreshing.value = false
        }
    }
}

async function handleRetry() {
    initialLoading.value = true
    await systemStore.refresh()
    await loadMetrics()
    initialLoading.value = false
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

async function viewMetricDetails(name: string) {
    if (!isMounted.value) return

    try {
        const stats = await getMetricStats(name)
        if (!isMounted.value) return

        if (stats) {
            selectedMetric.value = stats
            showDetailsDialog.value = true
        } else {
            toast.add({
                severity: 'error',
                summary: '错误',
                detail: '获取指标详情失败',
                life: 3000
            })
        }
    } catch (error) {
        console.error('Failed to get metric details:', error)
        if (isMounted.value) {
            toast.add({
                severity: 'error',
                summary: '错误',
                detail: '获取指标详情失败',
                life: 3000
            })
        }
    }
}

async function handleExport() {
    const data = await exportMetrics()
    if (data) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `metrics-${new Date().toISOString()}.json`
        a.click()
        URL.revokeObjectURL(url)
        toast.add({
            severity: 'success',
            summary: '成功',
            detail: '指标数据已导出',
            life: 3000
        })
    } else {
        toast.add({
            severity: 'error',
            summary: '错误',
            detail: '导出失败',
            life: 3000
        })
    }
}

function confirmClear() {
    showClearDialog.value = true
}

async function clearData() {
    clearing.value = true
    const success = await clearMetrics()
    clearing.value = false

    if (success) {
        toast.add({
            severity: 'success',
            summary: '成功',
            detail: '指标数据已清空',
            life: 3000
        })
        showClearDialog.value = false
        await loadMetrics()
    } else {
        toast.add({
            severity: 'error',
            summary: '错误',
            detail: '清空失败',
            life: 3000
        })
    }
}

onMounted(async () => {
    isMounted.value = true
    initialLoading.value = true

    const success = await systemStore.refresh()
    await loadMetrics()

    initialLoading.value = false

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
    isMounted.value = false
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

.last-update {
    font-size: 12px;
    color: #94a3b8;
    margin-left: 4px;
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
.metrics-card,
.memory-card,
.key-metrics-card,
.metrics-list-card {
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

.metrics-overview {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
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

.memory-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 12px;
    margin-bottom: 16px;
}

.memory-item {
    display: flex;
    justify-content: space-between;
    padding: 8px 12px;
    background: #f8fafc;
    border-radius: 6px;
}

.memory-label {
    font-size: 13px;
    color: #64748b;
}

.memory-value {
    font-size: 13px;
    font-weight: 600;
    color: #1e293b;
}

.memory-bar {
    height: 8px;
    background: #e2e8f0;
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 8px;
}

.memory-bar-fill {
    height: 100%;
    background: linear-gradient(90deg, #3b82f6, #2563eb);
    transition: width 0.3s ease;
}

.memory-percentage {
    text-align: center;
    font-size: 13px;
    color: #64748b;
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

.metrics-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
}

.search-input {
    max-width: 300px;
}

.metrics-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.metric-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    background: #f8fafc;
    border-radius: 8px;
    border: 1px solid #e2e8f0;
    cursor: pointer;
    transition: all 0.2s ease;
}

.metric-item:hover {
    background: #eff6ff;
    border-color: #bfdbfe;
    transform: translateX(4px);
}

.metric-item-name {
    font-size: 14px;
    font-weight: 500;
    color: #1e293b;
    font-family: 'Courier New', monospace;
}

.details-section h3 {
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 16px;
    color: #1e293b;
    font-family: 'Courier New', monospace;
}

.stats-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
}

.stat-item {
    display: flex;
    justify-content: space-between;
    padding: 10px 12px;
    background: #f8fafc;
    border-radius: 6px;
}

.stat-item .stat-label {
    font-size: 13px;
    color: #64748b;
    font-weight: 500;
}

.stat-item .stat-value {
    font-size: 13px;
    font-weight: 600;
    color: #1e293b;
}

.confirm-content {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 16px 0;
}

@media (max-width: 1024px) {
    .stats-grid {
        grid-template-columns: repeat(2, 1fr);
    }

    .metrics-overview {
        grid-template-columns: repeat(2, 1fr);
    }

    .memory-grid {
        grid-template-columns: 1fr;
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
        gap: 8px;
    }

    .auto-refresh-control {
        width: 100%;
        justify-content: space-between;
    }

    .metrics-header {
        flex-direction: column;
        align-items: flex-start;
        gap: 12px;
    }

    .search-input {
        max-width: 100%;
        width: 100%;
    }

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
    .memory-item {
        background: #1e293b;
    }
    .memory-value {
        color: #e2e8f0;
    }
    .memory-bar {
        background: #334155;
    }
    .metric-item {
        background: #1e293b;
        border-color: #334155;
    }
    .metric-item:hover {
        background: #1e3a5f;
        border-color: #1e40af;
    }
    .metric-item-name {
        color: #e2e8f0;
    }
    .stat-item {
        background: #1e293b;
    }
    .stat-item .stat-value {
        color: #e2e8f0;
    }
    .details-section h3 {
        color: #e2e8f0;
    }
}
</style>
