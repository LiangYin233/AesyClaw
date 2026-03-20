<template>
    <div class="dashboard-page">
        <PageHeader title="总览" subtitle="以中文控制台视图集中观察系统状态、通道健康与 Token 消耗。">
            <template #actions>
                <div class="header-actions">
                    <div class="auto-refresh-control">
                        <InputSwitch v-model="autoRefresh" @change="toggleAutoRefresh" />
                        <span class="auto-refresh-label">自动刷新</span>
                        <span v-if="lastUpdateTime" class="last-update">{{ lastUpdateTime }}</span>
                    </div>
                    <Button label="刷新" icon="pi pi-refresh" outlined @click="refreshAll" :loading="refreshing" />
                    <Button label="重置 Token 统计" icon="pi pi-trash" severity="danger" outlined @click="showResetDialog = true" />
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
                        最后更新：{{ formatDateTime(usageStats.lastUpdated) }}
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

        <ConfirmDialog
            v-model:visible="showResetDialog"
            title="确认重置"
            message="确定要重置 Token 使用统计吗？此操作无法撤销。"
            :loading="resetting"
            confirm-label="重置"
            confirm-severity="danger"
            :on-confirm="resetUsage"
        />

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
import ConfirmDialog from '../components/common/ConfirmDialog.vue'
import DashboardChannelsCard from '../components/dashboard/DashboardChannelsCard.vue'
import DashboardStatsGrid from '../components/dashboard/DashboardStatsGrid.vue'
import { formatClock, formatDateTime, formatNumber } from '../utils/formatters'
import Button from 'primevue/button'
import InputSwitch from 'primevue/inputswitch'
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
        lastUpdateTime.value = `更新于 ${formatClock(new Date())}`
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
    color: var(--ui-text-muted);
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
    border: 1px solid var(--ui-border);
    border-radius: 12px;
    background: var(--ui-surface-muted);
}

.usage-label {
    color: var(--ui-text-muted);
    font-size: 14px;
}

.usage-value {
    color: var(--ui-text);
    font-size: 28px;
    font-weight: 700;
}

.usage-updated {
    margin-top: 16px;
    color: var(--ui-text-muted);
    font-size: 13px;
}

.daily-usage-section {
    margin-top: 24px;
    padding-top: 20px;
    border-top: 1px solid var(--ui-border);
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
    color: var(--ui-text);
}

.daily-usage-header span {
    font-size: 12px;
    color: var(--ui-text-muted);
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
    border: 1px solid var(--ui-border);
    border-radius: 12px;
    background: var(--ui-surface);
    box-shadow: var(--ui-shadow-sm);
}

.daily-usage-date {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 88px;
}

.daily-usage-day {
    font-weight: 600;
    color: var(--ui-text);
}

.daily-usage-date-text {
    font-size: 12px;
    color: var(--ui-text-muted);
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
    color: var(--ui-text-muted);
}

.daily-usage-metric-value {
    font-size: 16px;
    font-weight: 600;
    color: var(--ui-text);
}

.daily-usage-metric.muted .daily-usage-metric-value {
    font-size: 14px;
    font-weight: 500;
    color: var(--ui-text-soft);
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
