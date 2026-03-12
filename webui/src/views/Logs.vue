<template>
    <div class="logs-page page-stack">
        <PageHeader title="日志管理" subtitle="统一调整日志级别并查看当前运行配置。">
            <template #actions>
                <Button label="刷新" icon="pi pi-refresh" outlined @click="loadConfig" :loading="loading" />
            </template>
        </PageHeader>

        <LoadingContainer :loading="loading && !config" loading-text="正在加载日志配置...">
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

                    <div class="level-info">
                        <h3>日志级别说明</h3>
                        <div class="level-list">
                            <div v-for="level in logLevels" :key="level.value" class="level-item">
                                <Tag :value="level.label" :severity="getLevelSeverity(level.value)" />
                                <span class="level-description">{{ level.description }}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </PageSection>
        </LoadingContainer>

        <Toast />
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useLogsStore } from '../stores'
import { useToast } from 'primevue/usetoast'
import Button from 'primevue/button'
import Select from 'primevue/select'
import Tag from 'primevue/tag'
import Toast from 'primevue/toast'
import PageHeader from '../components/common/PageHeader.vue'
import LoadingContainer from '../components/common/LoadingContainer.vue'
import PageSection from '../components/common/PageSection.vue'

const logsStore = useLogsStore()
const { config, loading } = storeToRefs(logsStore)
const toast = useToast()

const applying = ref(false)
const selectedLevel = ref('')

const logLevels = [
    { label: 'ERROR', value: 'error', description: '仅记录错误信息' },
    { label: 'WARN', value: 'warn', description: '记录警告和错误信息' },
    { label: 'INFO', value: 'info', description: '记录一般信息、警告和错误' },
    { label: 'DEBUG', value: 'debug', description: '记录调试信息和以上所有级别' }
]

async function loadConfig() {
    const loadedConfig = await logsStore.fetchConfig()
    if (loadedConfig) {
        selectedLevel.value = loadedConfig.level
    }
}

async function applyLogLevel() {
    if (!selectedLevel.value) return

    applying.value = true
    const success = await logsStore.setLogLevel(selectedLevel.value)
    applying.value = false

    if (success) {
        toast.add({ severity: 'success', summary: '成功', detail: `日志级别已更新为 ${selectedLevel.value.toUpperCase()}`, life: 3000 })
        await loadConfig()
    } else {
        toast.add({ severity: 'error', summary: '错误', detail: '更新日志级别失败', life: 3000 })
    }
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

onMounted(() => {
    loadConfig()
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

.current-config {
    padding: var(--ui-space-5);
}

.current-config h3,
.level-info h3 {
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

.level-info {
    padding: var(--ui-space-5);
    border-radius: var(--ui-radius-md);
    border: 1px solid rgba(96, 165, 250, 0.2);
    background: linear-gradient(180deg, rgba(239, 246, 255, 0.84), rgba(219, 234, 254, 0.72));
}

.level-list {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-3);
}

.level-item {
    display: flex;
    gap: var(--ui-space-3);
    align-items: center;
}

.level-description {
    font-size: 0.9rem;
    color: var(--ui-text-soft);
}

@media (max-width: 768px) {
    .level-selector {
        flex-direction: column;
    }

    .level-selector :deep(.p-select),
    .level-selector :deep(.p-button) {
        width: 100%;
    }

    .level-item {
        align-items: flex-start;
        flex-direction: column;
        gap: var(--ui-space-2);
    }
}

@media (prefers-color-scheme: dark) {
    .level-info {
        border-color: rgba(96, 165, 250, 0.22);
        background: linear-gradient(180deg, rgba(30, 41, 59, 0.92), rgba(30, 64, 175, 0.2));
    }
}
</style>
