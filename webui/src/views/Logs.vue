<template>
    <div class="logs-page page-stack">
        <PageHeader title="日志管理" subtitle="调整日志级别并查看当前运行中的最近日志。">
            <template #actions>
                <Button label="刷新" icon="pi pi-refresh" outlined @click="refreshAll" :loading="loading || entriesLoading" />
            </template>
        </PageHeader>

        <LoadingContainer :loading="loading && !config" :error="!config ? error : null" loading-text="正在加载日志配置..." :on-retry="refreshAll">
            <PageSection
                v-if="config"
                title="日志级别配置"
                subtitle="修改后立即生效，无需重启服务。"
            >
                <div class="config-section">
                    <div class="form-field">
                        <label>当前日志级别</label>
                        <div class="level-selector">
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
                        <small class="field-hint">修改日志级别后立即生效，无需重启服务</small>
                    </div>

                    <div class="current-config surface-panel">
                        <h3>当前配置</h3>
                        <div class="config-grid logs-config-grid">
                            <div class="config-item">
                                <span class="config-label">日志级别</span>
                                <Tag :value="config.level.toUpperCase()" :severity="getLevelSeverity(config.level)" />
                            </div>
                            <div v-if="config.prefix" class="config-item">
                                <span class="config-label">日志前缀</span>
                                <Tag :value="config.prefix" severity="info" />
                            </div>
                        </div>
                    </div>
                </div>
            </PageSection>
        </LoadingContainer>

        <PageSection title="日志内容" subtitle="展示当前进程最近输出的日志，自动刷新。">
            <div class="logs-toolbar surface-panel">
                <div class="toolbar-group">
                    <div class="toolbar-field">
                        <label>级别筛选</label>
                        <Select
                            v-model="selectedFilter"
                            :options="filterOptions"
                            optionLabel="label"
                            optionValue="value"
                            @change="applyFilter"
                        />
                    </div>
                </div>

                <div class="toolbar-meta">
                    <span class="meta-item">最近 {{ logEntries.length }} 条</span>
                    <span class="meta-item" v-if="lastUpdate">更新于 {{ formatLastUpdate(lastUpdate) }}</span>
                </div>
            </div>

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

                <div v-else class="console-panel" role="log" aria-live="polite">
                    <div class="console-toolbar">
                        <div class="console-dots" aria-hidden="true">
                            <span class="console-dot console-dot--red"></span>
                            <span class="console-dot console-dot--yellow"></span>
                            <span class="console-dot console-dot--green"></span>
                        </div>
                        <span class="console-title">runtime.log</span>
                    </div>

                    <div class="console-body">
                        <article v-for="entry in logEntries" :key="entry.id" class="console-line" :class="`console-line--${entry.level}`">
                            <span class="console-line__time">{{ formatTimestamp(entry.timestamp) }}</span>
                            <span class="console-line__level">{{ entry.level.toUpperCase() }}</span>
                            <span v-if="entry.prefix" class="console-line__prefix">{{ entry.prefix }}</span>
                            <pre class="console-line__text">{{ entry.message }}<template v-if="entry.context"> | {{ entry.context }}</template></pre>
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
import Tag from 'primevue/tag'
import Toast from 'primevue/toast'
import EmptyState from '../components/common/EmptyState.vue'
import PageHeader from '../components/common/PageHeader.vue'
import LoadingContainer from '../components/common/LoadingContainer.vue'
import PageSection from '../components/common/PageSection.vue'

const logsStore = useLogsStore()
const { config, entries, loading, entriesLoading, error, lastUpdate, activeLevel } = storeToRefs(logsStore)
const toast = useToast()

const applying = ref(false)
const selectedLevel = ref('info')
const selectedFilter = ref<'all' | 'debug' | 'info' | 'warn' | 'error'>('all')

const logLevels = [
    { label: 'ERROR', value: 'error' },
    { label: 'WARN', value: 'warn' },
    { label: 'INFO', value: 'info' },
    { label: 'DEBUG', value: 'debug' }
]

const filterOptions = [
    { label: '全部', value: 'all' },
    { label: 'ERROR', value: 'error' },
    { label: 'WARN', value: 'warn' },
    { label: 'INFO', value: 'info' },
    { label: 'DEBUG', value: 'debug' }
]

const logEntries = computed(() => entries.value)

async function loadConfig() {
    const loadedConfig = await logsStore.fetchConfig()
    if (loadedConfig) {
        selectedLevel.value = loadedConfig.level
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
        toast.add({ severity: 'success', summary: '成功', detail: `日志级别已更新为 ${selectedLevel.value.toUpperCase()}`, life: 3000 })
        await loadConfig()
        await loadEntries()
    } else {
        toast.add({ severity: 'error', summary: '错误', detail: logsStore.error || '更新日志级别失败', life: 3000 })
    }
}

async function applyFilter() {
    await loadEntries()
}

function getLevelSeverity(level: string): 'success' | 'info' | 'warn' | 'danger' {
    const severities: Record<string, 'success' | 'info' | 'warn' | 'danger'> = {
        error: 'danger',
        warn: 'warn',
        info: 'info',
        debug: 'success'
    }
    return severities[level] || 'info'
}

function formatTimestamp(value: string) {
    return new Date(value).toLocaleString()
}

function formatLastUpdate(value: number) {
    return new Date(value).toLocaleTimeString()
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
.config-section {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-6);
}

.level-selector {
    display: flex;
    gap: var(--ui-space-3);
    align-items: flex-start;
}

.level-selector :deep(.p-select) {
    flex: 1;
}

.current-config,
.logs-toolbar {
    padding: var(--ui-space-5);
}

.current-config h3 {
    margin: 0 0 var(--ui-space-4) 0;
    font-size: 0.95rem;
    font-weight: 700;
}

.logs-config-grid {
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}

.config-item {
    display: flex;
    gap: var(--ui-space-3);
    align-items: center;
    min-width: 0;
}

.config-label {
    font-size: 0.84rem;
    color: var(--ui-text-muted);
    font-weight: 600;
}

.logs-toolbar {
    display: flex;
    justify-content: space-between;
    gap: var(--ui-space-4);
    align-items: end;
}

.toolbar-group,
.toolbar-field {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-2);
}

.toolbar-field label {
    font-size: 0.84rem;
    color: var(--ui-text-muted);
    font-weight: 600;
}

.toolbar-meta {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--ui-space-3);
    color: var(--ui-text-muted);
    font-size: 0.88rem;
}

.console-panel {
    overflow: hidden;
    border-radius: 18px;
    border: 1px solid rgba(148, 163, 184, 0.18);
    background: #0b1220;
    box-shadow: 0 20px 45px rgba(15, 23, 42, 0.18);
}

.console-toolbar {
    display: flex;
    align-items: center;
    gap: var(--ui-space-3);
    padding: 14px 18px;
    border-bottom: 1px solid rgba(148, 163, 184, 0.12);
    background: linear-gradient(180deg, rgba(30, 41, 59, 0.95), rgba(15, 23, 42, 0.92));
}

.console-dots {
    display: flex;
    gap: 8px;
}

.console-dot {
    width: 11px;
    height: 11px;
    border-radius: 999px;
}

.console-dot--red {
    background: #f87171;
}

.console-dot--yellow {
    background: #fbbf24;
}

.console-dot--green {
    background: #34d399;
}

.console-title {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace;
    font-size: 0.84rem;
    color: rgba(226, 232, 240, 0.9);
}

.console-body {
    max-height: 68vh;
    overflow: auto;
    padding: 14px 0;
}

.console-line {
    display: grid;
    grid-template-columns: 168px 68px minmax(0, 180px) minmax(0, 1fr);
    gap: 12px;
    align-items: start;
    padding: 8px 18px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace;
    font-size: 0.85rem;
    line-height: 1.65;
    color: #e2e8f0;
}

.console-line:hover {
    background: rgba(255, 255, 255, 0.03);
}

.console-line__time {
    color: #94a3b8;
    white-space: nowrap;
}

.console-line__level {
    font-weight: 700;
    letter-spacing: 0.04em;
}

.console-line__prefix {
    color: #cbd5e1;
    opacity: 0.9;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.console-line__text {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    color: inherit;
}

.console-line--debug .console-line__level,
.console-line--debug .console-line__text {
    color: #93c5fd;
}

.console-line--info .console-line__level,
.console-line--info .console-line__text {
    color: #e2e8f0;
}

.console-line--warn .console-line__level,
.console-line--warn .console-line__text {
    color: #fbbf24;
}

.console-line--error .console-line__level,
.console-line--error .console-line__text {
    color: #f87171;
}

@media (max-width: 768px) {
    .level-selector,
    .logs-toolbar {
        flex-direction: column;
        align-items: stretch;
    }

    .level-selector :deep(.p-select),
    .level-selector :deep(.p-button),
    .toolbar-field :deep(.p-select) {
        width: 100%;
    }

    .toolbar-meta {
        justify-content: flex-start;
    }

    .console-line {
        grid-template-columns: 1fr;
        gap: 4px;
    }

    .console-line__prefix {
        white-space: normal;
    }
}
</style>
