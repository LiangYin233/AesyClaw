<template>
    <div class="logs-page page-stack">
        <PageHeader title="日志管理" subtitle="以更清晰的运行面板视图查看最近日志与日志级别。">
            <template #actions>
                <Button label="刷新" icon="pi pi-refresh" outlined @click="refreshAll" :loading="loading || entriesLoading" />
            </template>
        </PageHeader>

        <LoadingContainer
            :loading="loading && !config"
            :error="!config ? error : null"
            loading-text="正在加载日志配置..."
            :on-retry="refreshAll"
        >
            <PageSection
                v-if="config"
                title="运行概览"
                subtitle="当前日志级别、缓存容量与日志流状态会在这里统一展示。"
            >
                <div class="monitor-overview">
                    <article class="monitor-stat monitor-stat--primary">
                        <span class="monitor-stat__label">当前日志级别</span>
                        <strong class="monitor-stat__value">{{ formatLevelLabel(config.level) }}</strong>
                        <span class="monitor-stat__meta">实时生效</span>
                    </article>
                    <article class="monitor-stat">
                        <span class="monitor-stat__label">当前列表条数</span>
                        <strong class="monitor-stat__value">{{ logEntries.length }}</strong>
                        <span class="monitor-stat__meta">受筛选条件影响</span>
                    </article>
                    <article class="monitor-stat">
                        <span class="monitor-stat__label">最近更新时间</span>
                        <strong class="monitor-stat__value monitor-stat__value--compact">{{ lastUpdateLabel }}</strong>
                        <span class="monitor-stat__meta">轮询刷新中</span>
                    </article>
                </div>

                <div class="monitor-actions">
                    <section class="monitor-card surface-panel">
                        <div class="monitor-card__head">
                            <div>
                                <h3>日志级别</h3>
                                <p>修改后立即生效，无需重启服务。</p>
                            </div>
                            <span class="level-badge" :class="`level-badge--${config.level}`">{{ formatLevelLabel(config.level) }}</span>
                        </div>
                        <div class="control-row">
                            <Select
                                v-model="selectedLevel"
                                :options="logLevels"
                                optionLabel="label"
                                optionValue="value"
                                placeholder="选择日志级别"
                                fluid
                            />
                            <Button
                                label="应用"
                                icon="pi pi-check"
                                @click="applyLogLevel"
                                :loading="applying"
                                :disabled="selectedLevel === config.level"
                            />
                        </div>
                    </section>

                    <section class="monitor-card surface-panel">
                        <div class="monitor-card__head">
                            <div>
                                <h3>日志筛选</h3>
                                <p>筛选当前进程中最近输出的日志记录。</p>
                            </div>
                            <span class="filter-hint">共 {{ logEntries.length }} 条</span>
                        </div>
                        <div class="control-row control-row--single">
                            <Select
                                v-model="selectedFilter"
                                :options="filterOptions"
                                optionLabel="label"
                                optionValue="value"
                                @change="applyFilter"
                            />
                        </div>
                    </section>
                </div>
            </PageSection>
        </LoadingContainer>

        <PageSection title="日志流">
            <LoadingContainer
                :loading="entriesLoading && logEntries.length === 0"
                :error="logEntries.length === 0 ? error : null"
                loading-text="正在加载日志内容..."
                :on-retry="loadEntries"
            >
                <EmptyState
                    v-if="logEntries.length === 0"
                    icon="pi pi-file"
                    title="暂无日志"
                    description="当前没有可展示的运行日志，稍后刷新再试。"
                />

                <div v-else class="logs-stream" role="log" aria-live="polite">
                    <div class="logs-stream__toolbar">
                        <h3>运行日志</h3>
                        <div class="logs-stream__meta">
                            <span class="stream-meta">筛选：{{ filterLabel }}</span>
                            <span class="stream-meta">更新于 {{ lastUpdateLabel }}</span>
                            <span class="stream-meta">共 {{ logEntries.length }} 条</span>
                        </div>
                    </div>

                    <div class="logs-stream__list">
                        <article
                            v-for="entry in logEntries"
                            :key="entry.id"
                            class="log-row"
                            :class="`log-row--${entry.level}`"
                        >
                            <div class="log-row__meta">
                                <span class="log-row__time">{{ formatDateTime(entry.timestamp) }}</span>
                                <span class="log-row__submeta">
                                    <span class="log-level" :class="`log-level--${entry.level}`">{{ formatLevelLabel(entry.level) }}</span>
                                    <span v-if="entry.scope" class="log-scope">{{ entry.scope }}</span>
                                </span>
                            </div>
                            <div class="log-row__content">
                                <pre class="log-row__message">{{ entry.message }}</pre>
                                <div v-if="formatFieldSummary(entry.fields)" class="log-row__fields">
                                    {{ formatFieldSummary(entry.fields) }}
                                </div>
                            </div>
                        </article>
                    </div>
                </div>
            </LoadingContainer>
        </PageSection>

        <Toast />
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useLogsStore } from '../stores'
import { useToast } from 'primevue/usetoast'
import Button from 'primevue/button'
import Select from 'primevue/select'
import Toast from 'primevue/toast'
import EmptyState from '../components/common/EmptyState.vue'
import PageHeader from '../components/common/PageHeader.vue'
import LoadingContainer from '../components/common/LoadingContainer.vue'
import PageSection from '../components/common/PageSection.vue'
import { formatClock, formatDateTime } from '../utils/formatters'

type LogFilterLevel = 'all' | 'debug' | 'info' | 'warn' | 'error'
type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const logsStore = useLogsStore()
const { config, entries, loading, entriesLoading, error, lastUpdate, activeLevel } = storeToRefs(logsStore)
const toast = useToast()

const applying = ref(false)
const selectedLevel = ref<LogLevel>('info')
const selectedFilter = ref<LogFilterLevel>('all')

const levelLabelMap: Record<LogFilterLevel, string> = {
    all: '全部',
    error: '错误',
    warn: '警告',
    info: '信息',
    debug: '调试'
}

const logLevels = [
    { label: '错误', value: 'error' },
    { label: '警告', value: 'warn' },
    { label: '信息', value: 'info' },
    { label: '调试', value: 'debug' }
]

const filterOptions = [
    { label: '全部', value: 'all' },
    { label: '错误', value: 'error' },
    { label: '警告', value: 'warn' },
    { label: '信息', value: 'info' },
    { label: '调试', value: 'debug' }
]

const logEntries = computed(() => entries.value)
const lastUpdateLabel = computed(() => (lastUpdate.value ? formatClock(new Date(lastUpdate.value)) : '尚未刷新'))
const filterLabel = computed(() => levelLabelMap[selectedFilter.value])

function formatLevelLabel(level: LogFilterLevel | string) {
    return levelLabelMap[level as LogFilterLevel] || String(level).toUpperCase()
}

async function loadConfig() {
    const loadedConfig = await logsStore.fetchConfig()
    if (loadedConfig) {
        selectedLevel.value = loadedConfig.level as LogLevel
    }
}

async function loadEntries() {
    await logsStore.fetchEntries(selectedFilter.value)
}

async function refreshAll() {
    await Promise.all([loadConfig(), loadEntries()])
}

async function applyLogLevel() {
    if (!selectedLevel.value) return

    applying.value = true
    const success = await logsStore.setLogLevel(selectedLevel.value)
    applying.value = false

    if (success) {
        toast.add({ severity: 'success', summary: '成功', detail: `日志级别已更新为${formatLevelLabel(selectedLevel.value)}`, life: 3000 })
        await loadConfig()
        await loadEntries()
    } else {
        toast.add({ severity: 'error', summary: '错误', detail: logsStore.error || '更新日志级别失败', life: 3000 })
    }
}

async function applyFilter() {
    await loadEntries()
}

function getFieldEntries(fields?: Record<string, string | number | boolean | null>) {
    if (!fields) return []
    return Object.entries(fields).map(([key, value]) => ({
        key,
        value: String(value)
    }))
}

function formatFieldSummary(fields?: Record<string, string | number | boolean | null>) {
    const entries = getFieldEntries(fields)
    if (entries.length === 0) return ''
    return entries.map((entry) => `${entry.key}=${entry.value}`).join('  ·  ')
}

onMounted(async () => {
    selectedFilter.value = activeLevel.value
    await refreshAll()
    logsStore.startPolling(3000)
})

onUnmounted(() => {
    logsStore.stopPolling()
})
</script>

<style scoped>
.monitor-overview {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--ui-space-4);
    margin-bottom: var(--ui-space-5);
}

.monitor-stat {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
    padding: var(--ui-space-5);
    border: 1px solid var(--ui-border);
    border-radius: var(--ui-radius-md);
    background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(248, 251, 255, 0.92)),
        linear-gradient(120deg, rgba(37, 99, 235, 0.04), transparent 60%);
    box-shadow: var(--ui-shadow-sm);
}

.monitor-stat__label {
    font-size: 0.82rem;
    letter-spacing: 0.04em;
    color: var(--ui-text-muted);
}

.monitor-stat__value {
    font-size: 1.45rem;
    line-height: 1.1;
    font-weight: 800;
    color: var(--ui-text);
}

.monitor-stat__value--compact {
    font-size: 1.12rem;
}

.monitor-stat__meta {
    font-size: 0.82rem;
    color: var(--ui-text-faint);
}

.monitor-actions {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(280px, 0.9fr);
    gap: var(--ui-space-4);
}

.monitor-card {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-4);
    padding: var(--ui-space-5);
}

.monitor-card__head {
    display: flex;
    justify-content: space-between;
    gap: var(--ui-space-4);
    align-items: flex-start;
}

.monitor-card__head h3 {
    margin: 0 0 6px 0;
    font-size: 1rem;
    font-weight: 700;
    color: var(--ui-text);
}

.monitor-card__head p {
    margin: 0;
    font-size: 0.88rem;
    line-height: 1.5;
    color: var(--ui-text-muted);
}

.level-badge,
.filter-hint {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 32px;
    padding: 0 12px;
    border-radius: 999px;
    font-size: 0.8rem;
    font-weight: 700;
    white-space: nowrap;
}

.level-badge {
    border: 1px solid rgba(148, 163, 184, 0.22);
    background: rgba(255, 255, 255, 0.75);
    color: var(--ui-text-soft);
}

.level-badge--debug {
    color: #0369a1;
    background: rgba(224, 242, 254, 0.92);
}

.level-badge--info {
    color: #1d4ed8;
    background: rgba(219, 234, 254, 0.92);
}

.level-badge--warn {
    color: #b45309;
    background: rgba(254, 243, 199, 0.92);
}

.level-badge--error {
    color: #b91c1c;
    background: rgba(254, 226, 226, 0.92);
}

.filter-hint {
    color: var(--ui-text-muted);
    background: var(--ui-overlay);
}

.control-row {
    display: flex;
    gap: var(--ui-space-3);
    align-items: stretch;
}

.control-row :deep(.p-select) {
    flex: 1;
}

.control-row--single :deep(.p-select) {
    width: 100%;
}

.logs-stream__toolbar {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--ui-space-4);
    padding: 0 0 var(--ui-space-4) 0;
}

.logs-stream__toolbar h3 {
    margin: 0;
    font-size: 1rem;
    font-weight: 700;
    color: var(--ui-text);
}

.logs-stream__meta {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--ui-space-2);
}

.stream-meta {
    font-size: 0.82rem;
    color: var(--ui-text-muted);
}

.logs-stream__list {
    display: flex;
    flex-direction: column;
    max-height: 72vh;
    overflow: auto;
    border-top: 1px solid var(--ui-border);
    border-bottom: 1px solid var(--ui-border);
    background: rgba(255, 255, 255, 0.45);
}

.log-row {
    display: grid;
    grid-template-columns: 188px minmax(0, 1fr);
    gap: var(--ui-space-4);
    padding: 16px var(--ui-space-4);
    border-bottom: 1px solid var(--ui-border);
    background: transparent;
    transition: background-color 0.18s ease;
}

.log-row:hover {
    background: rgba(239, 246, 255, 0.4);
}

.log-row__meta {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    padding-top: 2px;
}

.log-row__time {
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--ui-text-soft);
    white-space: nowrap;
}

.log-row__submeta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    min-width: 0;
}

.log-level {
    display: inline-flex;
    align-items: center;
    font-size: 0.76rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
}

.log-level--debug {
    color: #0369a1;
}

.log-level--info {
    color: #1d4ed8;
}

.log-level--warn {
    color: #b45309;
}

.log-level--error {
    color: #b91c1c;
}

.log-scope {
    min-width: 0;
    font-size: 0.8rem;
    color: var(--ui-text-faint);
    overflow: hidden;
    text-overflow: ellipsis;
}

.log-row__content {
    min-width: 0;
}

.log-row__message {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace;
    font-size: 0.92rem;
    line-height: 1.72;
    color: var(--ui-text-soft);
}

.log-row__fields {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px dashed rgba(148, 163, 184, 0.18);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace;
    font-size: 0.76rem;
    line-height: 1.65;
    color: var(--ui-text-muted);
    word-break: break-word;
}

.log-row--debug {
    box-shadow: none;
}

.log-row--debug .log-row__message {
    color: #0f172a;
}

.log-row--info {
    box-shadow: none;
}

.log-row--info .log-row__message {
    color: var(--ui-text-soft);
}

.log-row--warn {
    box-shadow: none;
}

.log-row--warn .log-row__message {
    color: #92400e;
}

.log-row--error {
    box-shadow: none;
}

.log-row--error .log-row__message {
    color: #991b1b;
}

@media (max-width: 1120px) {
    .monitor-overview {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .monitor-actions {
        grid-template-columns: 1fr;
    }

    .logs-stream__toolbar {
        flex-direction: column;
        align-items: stretch;
    }

    .logs-stream__meta {
        justify-content: flex-start;
    }

    .log-row {
        grid-template-columns: 156px minmax(0, 1fr);
    }
}

@media (max-width: 768px) {
    .monitor-overview {
        grid-template-columns: 1fr;
    }

    .monitor-card,
    .monitor-stat {
        padding: var(--ui-space-4);
    }

    .monitor-card__head,
    .control-row {
        flex-direction: column;
        align-items: stretch;
    }

    .control-row :deep(.p-select),
    .control-row :deep(.p-button) {
        width: 100%;
    }

    .logs-stream__toolbar {
        padding-bottom: var(--ui-space-3);
    }

    .logs-stream__list {
        max-height: 64vh;
    }

    .log-row {
        grid-template-columns: 1fr;
        gap: 8px;
        padding: 14px 0;
    }

    .log-row__meta {
        gap: 6px;
    }

    .log-scope {
        white-space: normal;
        overflow: visible;
    }

    .log-row__message {
        font-size: 0.88rem;
        line-height: 1.7;
    }

    .log-row__fields {
        font-size: 0.75rem;
    }
}
</style>
