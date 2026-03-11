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
            <DashboardStatsGrid
                :version="systemStore.version"
                :uptime="systemStore.uptime"
                :session-count="systemStore.sessionCount"
                :agent-running="systemStore.agentRunning"
                :format-uptime="formatUptime"
            />

            <DashboardChannelsCard :channels="systemStore.channels" />

            <DashboardMetricsCards
                :overview="metricsOverview"
                :memory="memory"
                :key-metrics="keyMetrics"
                :format-bytes="formatBytes"
                :format-metric-name="formatMetricName"
                :format-metric-value="formatMetricValue"
            />

            <DashboardMetricsList
                :metric-names="metricNames"
                :filtered-metrics="filteredMetrics"
                :search-query="searchQuery"
                @update:search-query="searchQuery = $event"
                @view-details="viewMetricDetails"
            />
        </LoadingContainer>

        <Dialog v-model:visible="showDetailsDialog" header="指标详情" :style="{ width: '600px' }" modal>
            <div v-if="selectedMetric">
                <div class="details-section">
                    <h3>{{ selectedMetric.name }}</h3>
                    <div class="stats-grid">
                        <div class="stat-item">
                            <span class="stat-label">计数:</span>
                            <span class="stat-value">{{ selectedMetric.count ?? '-' }}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">总和:</span>
                            <span class="stat-value">{{ selectedMetric.sum != null ? selectedMetric.sum.toFixed(2) : '-' }}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">最小值:</span>
                            <span class="stat-value">{{ selectedMetric.min != null ? selectedMetric.min.toFixed(2) : '-' }}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">最大值:</span>
                            <span class="stat-value">{{ selectedMetric.max != null ? selectedMetric.max.toFixed(2) : '-' }}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">平均值:</span>
                            <span class="stat-value">{{ selectedMetric.mean != null ? selectedMetric.mean.toFixed(2) : '-' }}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">P50:</span>
                            <span class="stat-value">{{ selectedMetric.p50 != null ? selectedMetric.p50.toFixed(2) : '-' }}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">P95:</span>
                            <span class="stat-value">{{ selectedMetric.p95 != null ? selectedMetric.p95.toFixed(2) : '-' }}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">P99:</span>
                            <span class="stat-value">{{ selectedMetric.p99 != null ? selectedMetric.p99.toFixed(2) : '-' }}</span>
                        </div>
                    </div>
                </div>
            </div>
            <template #footer>
                <Button label="关闭" @click="showDetailsDialog = false" />
            </template>
        </Dialog>

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
import type { MetricStats } from '../types/api'
import { useMetricsStore, useSystemStore } from '../stores'
import { announceToScreenReader } from '../composables/useA11y'
import { useToast } from 'primevue/usetoast'
import PageHeader from '../components/common/PageHeader.vue'
import LoadingContainer from '../components/common/LoadingContainer.vue'
import DashboardChannelsCard from '../components/dashboard/DashboardChannelsCard.vue'
import DashboardMetricsCards from '../components/dashboard/DashboardMetricsCards.vue'
import DashboardMetricsList from '../components/dashboard/DashboardMetricsList.vue'
import DashboardStatsGrid from '../components/dashboard/DashboardStatsGrid.vue'
import Button from 'primevue/button'
import InputSwitch from 'primevue/inputswitch'
import Dialog from 'primevue/dialog'
import Toast from 'primevue/toast'

const systemStore = useSystemStore()
const metricsStore = useMetricsStore()
const toast = useToast()

const metricsOverview = computed(() => metricsStore.overview)
const memory = computed(() => metricsStore.memoryUsage)
const metricNames = computed(() => metricsStore.metricNames)
const keyMetrics = ref<Array<MetricStats & { name: string; unit: string }>>([])
const autoRefresh = ref(true)
const refreshing = ref(false)
const clearing = ref(false)
const lastUpdateTime = ref('')
const searchQuery = ref('')
const showDetailsDialog = ref(false)
const showClearDialog = ref(false)
const selectedMetric = computed(() => metricsStore.selectedMetric)
const isMounted = ref(false)
const initialLoading = ref(true)

let refreshInterval: number | null = null

const KEY_METRIC_NAMES = [
    'db.query_time',
    'api.request_time',
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
        const { names } = await metricsStore.refreshAll()

        if (!isMounted.value) return

        if (names) {
            const metrics: Array<MetricStats & { name: string; unit: string }> = []
            for (const name of KEY_METRIC_NAMES) {
                if (names.includes(name)) {
                    const stats = await metricsStore.fetchMetricStats(name)
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
        const stats = await metricsStore.fetchMetricStats(name)
        if (!isMounted.value) return

        if (stats) {
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
    const data = await metricsStore.exportMetrics()
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
    const success = await metricsStore.clearMetrics()
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

@media (max-width: 640px) {
    .header-actions {
        flex-direction: column;
        width: 100%;
        gap: 8px;
    }

    .auto-refresh-control {
        width: 100%;
        justify-content: space-between;
    }

    .stats-grid {
        grid-template-columns: 1fr;
    }
}

@media (prefers-color-scheme: dark) {
    .auto-refresh-control {
        background: #1e293b;
        border-color: #334155;
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
