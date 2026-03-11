<template>
    <div class="logs-page">
        <div class="page-header">
            <h1>日志管理</h1>
            <div class="header-actions">
                <Button label="刷新" icon="pi pi-refresh" outlined @click="loadConfig" :loading="loading" />
            </div>
        </div>

        <div v-if="config" class="logs-content">
            <Card>
                <template #title>日志级别配置</template>
                <template #content>
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
                            <small class="field-hint">
                                修改日志级别后立即生效，无需重启服务
                            </small>
                        </div>

                        <div class="current-config">
                            <h3>当前配置</h3>
                            <div class="config-grid">
                                <div class="config-item">
                                    <span class="config-label">日志级别:</span>
                                    <Tag :value="config.level.toUpperCase()" :severity="getLevelSeverity(config.level)" />
                                </div>
                                <div v-if="config.prefix" class="config-item">
                                    <span class="config-label">日志前缀:</span>
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
                </template>
            </Card>
        </div>

        <div v-else-if="loading" class="loading-container">
            <ProgressSpinner />
        </div>

        <Toast />
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useLogsStore } from '../stores'
import { useToast } from 'primevue/usetoast'
import Button from 'primevue/button'
import Card from 'primevue/card'
import Select from 'primevue/select'
import Tag from 'primevue/tag'
import Toast from 'primevue/toast'
import ProgressSpinner from 'primevue/progressspinner'

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
.logs-page {
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
}

.logs-content {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.config-section {
    display: flex;
    flex-direction: column;
    gap: 24px;
}

.form-field {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.form-field label {
    font-size: 14px;
    font-weight: 600;
    color: #475569;
}

.level-selector {
    display: flex;
    gap: 12px;
    align-items: flex-start;
}

.level-selector :deep(.p-select) {
    flex: 1;
}

.field-hint {
    font-size: 12px;
    color: #94a3b8;
}

.current-config {
    padding: 16px;
    background: #f8fafc;
    border-radius: 8px;
    border: 1px solid #e2e8f0;
}

.current-config h3 {
    font-size: 14px;
    font-weight: 600;
    margin: 0 0 12px 0;
    color: #1e293b;
}

.config-grid {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.config-item {
    display: flex;
    gap: 12px;
    align-items: center;
}

.config-label {
    font-size: 13px;
    color: #64748b;
    font-weight: 500;
    min-width: 80px;
}

.transport-tags {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
}

.level-info {
    padding: 16px;
    background: #eff6ff;
    border-radius: 8px;
    border: 1px solid #bfdbfe;
}

.level-info h3 {
    font-size: 14px;
    font-weight: 600;
    margin: 0 0 12px 0;
    color: #1e40af;
}

.level-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.level-item {
    display: flex;
    gap: 12px;
    align-items: center;
}

.level-description {
    font-size: 13px;
    color: #475569;
}

.loading-container {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 48px;
}

@media (max-width: 768px) {
    .level-selector {
        flex-direction: column;
    }

    .level-selector :deep(.p-select) {
        width: 100%;
    }
}

@media (prefers-color-scheme: dark) {
    .form-field label {
        color: #94a3b8;
    }

    .current-config {
        background: #1e293b;
        border-color: #334155;
    }

    .current-config h3 {
        color: #e2e8f0;
    }

    .level-info {
        background: #1e3a5f;
        border-color: #1e40af;
    }

    .level-info h3 {
        color: #93c5fd;
    }

    .level-description {
        color: #cbd5e1;
    }
}
</style>
