<template>
    <div class="dashboard-page">
        <PageHeader title="仪表盘" subtitle="系统状态与 Token 使用统计">
            <template #actions>
                <div class="header-actions">
                    <div class="auto-refresh-control">
                        <InputSwitch v-model="autoRefresh" @change="toggleAutoRefresh" />
                        <span class="auto-refresh-label">自动刷新</span>
                        <span v-if="lastUpdateTime" class="last-update">{{ lastUpdateTime }}</span>
                    </div>
                    <Button label="刷新" icon="pi pi-refresh" outlined @click="refreshAll" :loading="refreshing" />
                    <Button label="重置 Token 统计" icon="pi pi-trash" severity="danger" outlined @click="confirmReset" />
                </div>
            </template>
        </PageHeader>

        <LoadingContainer
            :loading="initialLoading"
            :error="systemStore.error || usageError"
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

            <Card class="usage-card">
                <template #title>
                    <div class="usage-card-header">
                        <span>Token 使用统计</span>
                        <Tag :value="usageStats ? `${usageStats.requestCount} 次请求` : '暂无数据'" severity="info" />
                    </div>
                </template>
                <template #content>
                    <Message v-if="!usageStats" severity="info" :closable="false">
                        暂无 Token 使用数据。
                    </Message>
                    <div v-else class="usage-grid">
                        <div class="usage-stat">
                            <span class="usage-label">Prompt Tokens</span>
                            <span class="usage-value">{{ formatNumber(usageStats.promptTokens) }}</span>
                        </div>
                        <div class="usage-stat">
                            <span class="usage-label">Completion Tokens</span>
                            <span class="usage-value">{{ formatNumber(usageStats.completionTokens) }}</span>
                        </div>
                        <div class="usage-stat">
                            <span class="usage-label">Total Tokens</span>
                            <span class="usage-value">{{ formatNumber(usageStats.totalTokens) }}</span>
                        </div>
                        <div class="usage-stat">
                            <span class="usage-label">Request Count</span>
                            <span class="usage-value">{{ formatNumber(usageStats.requestCount) }}</span>
                        </div>
                    </div>
                    <div v-if="usageStats?.lastUpdated" class="usage-updated">
                        最后更新：{{ formatTimestamp(usageStats.lastUpdated) }}
                    </div>
                    <div v-if="usageStats" class="daily-usage-section">
                        <div class="daily-usage-header">
                            <h3>最近 7 天</h3>
                            <span>按服务端本地时区统计</span>
                        </div>
                        <div class="daily-usage-list">
                            <div
                                v-for="item in usageStats.daily"
                                :key="item.date"
                                class="daily-usage-row"
                            >
                                <div class="daily-usage-date">
                                    <span class="daily-usage-day">{{ formatDayLabel(item.date) }}</span>
                                    <span class="daily-usage-date-text">{{ item.date }}</span>
                                </div>
                                <div class="daily-usage-metrics">
                                    <div class="daily-usage-metric">
                                        <span class="daily-usage-metric-label">Total</span>
                                        <span class="daily-usage-metric-value">{{ formatNumber(item.totalTokens) }}</span>
                                    </div>
                                    <div class="daily-usage-metric">
                                        <span class="daily-usage-metric-label">Requests</span>
                                        <span class="daily-usage-metric-value">{{ formatNumber(item.requestCount) }}</span>
                                    </div>
                                    <div class="daily-usage-metric muted">
                                        <span class="daily-usage-metric-label">Prompt</span>
                                        <span class="daily-usage-metric-value">{{ formatNumber(item.promptTokens) }}</span>
                                    </div>
                                    <div class="daily-usage-metric muted">
                                        <span class="daily-usage-metric-label">Completion</span>
                                        <span class="daily-usage-metric-value">{{ formatNumber(item.completionTokens) }}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </template>
            </Card>
        </LoadingContainer>

        <Dialog v-model:visible="showResetDialog" header="确认重置" :style="{ width: '450px' }" modal>
            <div class="confirm-content">
                <i class="pi pi-exclamation-triangle confirm-icon"></i>
                <span>确定要重置 Token 使用统计吗？此操作无法撤销。</span>
            </div>
            <template #footer>
                <Button label="取消" text @click="showResetDialog = false" />
                <Button label="重置" severity="danger" @click="resetUsage" :loading="resetting" />
            </template>
        </Dialog>

        <Toast />
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useSystemStore } from '../stores'
import { apiGet, apiPost } from '../utils/apiClient'
import type { TokenUsageStats } from '../types/api'
import { useToast } from 'primevue/usetoast'
import PageHeader from '../components/common/PageHeader.vue'
import LoadingContainer from '../components/common/LoadingContainer.vue'
import DashboardChannelsCard from '../components/dashboard/DashboardChannelsCard.vue'
import DashboardStatsGrid from '../components/dashboard/DashboardStatsGrid.vue'
import Button from 'primevue/button'
import InputSwitch from 'primevue/inputswitch'
import Dialog from 'primevue/dialog'
import Toast from 'primevue/toast'
import Card from 'primevue/card'
import Tag from 'primevue/tag'
import Message from 'primevue/message'

const systemStore = useSystemStore()
const toast = useToast()

const usageStats = ref<TokenUsageStats | null>(null)
const usageError = ref<string | null>(null)
const autoRefresh = ref(true)
const refreshing = ref(false)
const resetting = ref(false)
const lastUpdateTime = ref('')
const showResetDialog = ref(false)
const initialLoading = ref(true)
const isMounted = ref(false)

let refreshInterval: number | null = null

function formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400)
    const hours = Math.floor((seconds % 86400) / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    if (days > 0) return `${days}天 ${hours}小时`
    if (hours > 0) return `${hours}小时 ${mins}分钟`
    return `${mins}分钟`
}

function formatNumber(value: number): string {
    return new Intl.NumberFormat('zh-CN').format(value)
}

function formatTimestamp(value: string): string {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {
        return value
    }
    return date.toLocaleString('zh-CN', { hour12: false })
}

function formatTime(date: Date): string {
    const hours = date.getHours().toString().padStart(2, '0')
    const minutes = date.getMinutes().toString().padStart(2, '0')
    const seconds = date.getSeconds().toString().padStart(2, '0')
    return `${hours}:${minutes}:${seconds}`
}

function formatDayLabel(value: string): string {
    const date = new Date(`${value}T00:00:00`)
    if (Number.isNaN(date.getTime())) {
        return value
    }

    return date.toLocaleDateString('zh-CN', {
        weekday: 'short'
    })
}

async function fetchUsage() {
    const { data, error } = await apiGet<TokenUsageStats>('/observability/usage')
    if (error) {
        usageError.value = error
        return false
    }

    usageStats.value = data
    usageError.value = null
    return true
}

async function refreshAll() {
    if (refreshing.value || !isMounted.value) return

    refreshing.value = true
    try {
        await Promise.all([
            systemStore.refresh(),
            fetchUsage()
        ])
        lastUpdateTime.value = `更新于 ${formatTime(new Date())}`
    } finally {
        refreshing.value = false
        initialLoading.value = false
    }
}

async function handleRetry() {
    await refreshAll()
}

function startAutoRefresh() {
    stopAutoRefresh()
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

function toggleAutoRefresh() {
    if (autoRefresh.value) {
        startAutoRefresh()
    } else {
        stopAutoRefresh()
    }
}

function confirmReset() {
    showResetDialog.value = true
}

async function resetUsage() {
    resetting.value = true
    const { error } = await apiPost('/observability/usage/reset')
    resetting.value = false

    if (error) {
        toast.add({ severity: 'error', summary: '错误', detail: error, life: 3000 })
        return
    }

    showResetDialog.value = false
    toast.add({ severity: 'success', summary: '成功', detail: 'Token 使用统计已重置', life: 3000 })
    await fetchUsage()
}

onMounted(async () => {
    isMounted.value = true
    await refreshAll()
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
    display: flex;
    flex-direction: column;
    gap: 24px;
}

.header-actions {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
}

.auto-refresh-control {
    display: flex;
    align-items: center;
    gap: 8px;
}

.auto-refresh-label,
.last-update {
    color: #64748b;
    font-size: 13px;
}

.usage-card {
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.usage-card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
}

.usage-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
}

.usage-stat {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 16px;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    background: #f8fafc;
}

.usage-label {
    color: #64748b;
    font-size: 14px;
}

.usage-value {
    color: #0f172a;
    font-size: 28px;
    font-weight: 700;
}

.usage-updated {
    margin-top: 16px;
    color: #64748b;
    font-size: 13px;
}

.daily-usage-section {
    margin-top: 24px;
    padding-top: 20px;
    border-top: 1px solid #e2e8f0;
}

.daily-usage-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
    margin-bottom: 12px;
}

.daily-usage-header h3 {
    margin: 0;
    font-size: 16px;
    color: #0f172a;
}

.daily-usage-header span {
    font-size: 12px;
    color: #64748b;
}

.daily-usage-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.daily-usage-row {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 16px;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    background: #ffffff;
}

.daily-usage-date {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 88px;
}

.daily-usage-day {
    font-weight: 600;
    color: #0f172a;
}

.daily-usage-date-text {
    font-size: 12px;
    color: #64748b;
}

.daily-usage-metrics {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
    flex: 1;
}

.daily-usage-metric {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.daily-usage-metric-label {
    font-size: 12px;
    color: #64748b;
}

.daily-usage-metric-value {
    font-size: 16px;
    font-weight: 600;
    color: #0f172a;
}

.daily-usage-metric.muted .daily-usage-metric-value {
    font-size: 14px;
    font-weight: 500;
    color: #334155;
}

.confirm-content {
    display: flex;
    align-items: center;
    gap: 12px;
}

.confirm-icon {
    font-size: 2rem;
    color: var(--red-500);
}

@media (max-width: 768px) {
    .usage-grid {
        grid-template-columns: 1fr;
    }

    .daily-usage-row {
        flex-direction: column;
    }

    .daily-usage-metrics {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .daily-usage-header {
        flex-direction: column;
        align-items: flex-start;
    }
}
</style>
