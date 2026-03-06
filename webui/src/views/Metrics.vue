<template>
    <div class="metrics-page">
        <div class="page-header">
            <h1>性能监控</h1>
            <div class="header-actions">
                <div class="auto-refresh-control">
                    <InputSwitch v-model="autoRefresh" @change="toggleAutoRefresh" />
                    <span class="auto-refresh-label">自动刷新</span>
                    <span v-if="lastUpdateTime" class="last-update">{{ lastUpdateTime }}</span>
                </div>
                <Button label="刷新" icon="pi pi-refresh" outlined @click="loadData" :loading="loading" />
                <Button label="导出" icon="pi pi-download" outlined @click="handleExport" />
                <Button label="清空" icon="pi pi-trash" severity="danger" outlined @click="confirmClear" />
            </div>
        </div>

        <div v-if="overview" class="metrics-content">
            <!-- Overview Card -->
            <Card class="overview-card">
                <template #title>概览</template>
                <template #content>
                    <div class="overview-grid">
                        <div class="overview-item">
                            <div class="overview-label">指标总数</div>
                            <div class="overview-value">{{ overview.totalMetrics }}</div>
                        </div>
                        <div class="overview-item">
                            <div class="overview-label">数据点总数</div>
                            <div class="overview-value">{{ overview.totalDataPoints }}</div>
                        </div>
                        <div class="overview-item">
                            <div class="overview-label">堆内存使用</div>
                            <div class="overview-value">{{ formatBytes(overview.memoryUsage.heapUsed) }}</div>
                            <div class="overview-sub">/ {{ formatBytes(overview.memoryUsage.heapTotal) }}</div>
                        </div>
                        <div class="overview-item">
                            <div class="overview-label">RSS 内存</div>
                            <div class="overview-value">{{ formatBytes(overview.memoryUsage.rss) }}</div>
                        </div>
                    </div>
                </template>
            </Card>

            <!-- Memory Usage Card -->
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

            <!-- Metrics List -->
            <Card class="metrics-card">
                <template #title>
                    <div class="metrics-header">
                        <span>指标列表</span>
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
                            <div class="metric-name">{{ name }}</div>
                            <i class="pi pi-chevron-right"></i>
                        </div>
                    </div>
                    <Message v-else severity="info" :closable="false">
                        {{ searchQuery ? '未找到匹配的指标' : '暂无指标数据' }}
                    </Message>
                </template>
            </Card>
        </div>

        <div v-else-if="loading" class="loading-container">
            <ProgressSpinner />
        </div>

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
import { useApi, type MetricOverview, type MemoryUsage, type MetricStats } from '../composables/useApi'
import { useToast } from 'primevue/usetoast'
import Button from 'primevue/button'
import Card from 'primevue/card'
import InputText from 'primevue/inputtext'
import InputSwitch from 'primevue/inputswitch'
import Message from 'primevue/message'
import Toast from 'primevue/toast'
import ProgressSpinner from 'primevue/progressspinner'
import Dialog from 'primevue/dialog'

const {
    getMetricOverview,
    getMemoryUsage,
    getMetricNames,
    getMetricStats,
    exportMetrics,
    clearMetrics
} = useApi()
const toast = useToast()

const overview = ref<MetricOverview | null>(null)
const memory = ref<MemoryUsage | null>(null)
const metricNames = ref<string[]>([])
const loading = ref(false)
const clearing = ref(false)
const searchQuery = ref('')
const showDetailsDialog = ref(false)
const showClearDialog = ref(false)
const selectedMetric = ref<MetricStats | null>(null)
const autoRefresh = ref(true)
const lastUpdateTime = ref('')

let refreshInterval: number | null = null

const filteredMetrics = computed(() => {
    if (!searchQuery.value) return metricNames.value
    const query = searchQuery.value.toLowerCase()
    return metricNames.value.filter(name => name.toLowerCase().includes(query))
})

function formatTime(date: Date): string {
    const hours = date.getHours().toString().padStart(2, '0')
    const minutes = date.getMinutes().toString().padStart(2, '0')
    const seconds = date.getSeconds().toString().padStart(2, '0')
    return `${hours}:${minutes}:${seconds}`
}

async function loadData() {
    loading.value = true
    const [overviewData, memoryData, names] = await Promise.all([
        getMetricOverview(),
        getMemoryUsage(),
        getMetricNames()
    ])
    overview.value = overviewData
    memory.value = memoryData
    metricNames.value = names
    lastUpdateTime.value = `最后更新: ${formatTime(new Date())}`
    loading.value = false
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
        loadData()
    }, 5000)
}

function stopAutoRefresh() {
    if (refreshInterval) {
        clearInterval(refreshInterval)
        refreshInterval = null
    }
}

async function viewMetricDetails(name: string) {
    const stats = await getMetricStats(name)
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
        await loadData()
    } else {
        toast.add({
            severity: 'error',
            summary: '错误',
            detail: '清空失败',
            life: 3000
        })
    }
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
}

onMounted(() => {
    loadData()
    if (autoRefresh.value) {
        startAutoRefresh()
    }
})

onUnmounted(() => {
    stopAutoRefresh()
})
</script>

<style scoped>
.metrics-page {
    padding: 0;
}

.page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24px;
}

.page-header h1 {
    margin: 0;
    font-size: 24px;
    font-weight: bold;
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

.metrics-content {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.overview-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 16px;
}

.overview-item {
    padding: 16px;
    background: #f8fafc;
    border-radius: 8px;
    text-align: center;
}

.overview-label {
    font-size: 13px;
    color: #64748b;
    margin-bottom: 8px;
}

.overview-value {
    font-size: 28px;
    font-weight: 700;
    color: #1e293b;
}

.overview-sub {
    font-size: 14px;
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

.metric-name {
    font-size: 14px;
    font-weight: 500;
    color: #1e293b;
    font-family: 'Courier New', monospace;
}

.loading-container {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 48px;
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

.stat-label {
    font-size: 13px;
    color: #64748b;
    font-weight: 500;
}

.stat-value {
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

@media (max-width: 768px) {
    .overview-grid {
        grid-template-columns: repeat(2, 1fr);
    }

    .memory-grid {
        grid-template-columns: 1fr;
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
    .overview-item {
        background: #1e293b;
    }

    .overview-value {
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

    .metric-name {
        color: #e2e8f0;
    }

    .stat-item {
        background: #1e293b;
    }

    .stat-value {
        color: #e2e8f0;
    }

    .details-section h3 {
        color: #e2e8f0;
    }
}
</style>
