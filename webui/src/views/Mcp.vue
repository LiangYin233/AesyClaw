<template>
    <div class="mcp-page">
        <div class="page-header">
            <h1>MCP 服务器管理</h1>
            <div class="header-actions">
                <Button label="刷新" icon="pi pi-refresh" outlined @click="loadConfig" :loading="loading" />
                <Button label="保存" icon="pi pi-save" @click="saveConfig" :loading="saving" :disabled="!config" />
            </div>
        </div>

        <div v-if="config" class="mcp-sections">
            <Card class="mcp-card">
                <template #title>
                    <div class="section-header">
                        <div class="section-title-group">
                            <span class="section-title">MCP 服务器配置</span>
                            <span class="section-subtitle">为 Agent 配置可用的 MCP 服务器来源</span>
                        </div>
                        <Button label="添加服务器" icon="pi pi-plus" size="small" @click="addMcp" />
                    </div>
                </template>
                <template #content>
                    <div v-if="config.mcp && Object.keys(config.mcp).length > 0" class="mcp-list">
                        <div
                            v-for="(value, key) in config.mcp"
                            :key="key"
                            class="mcp-section"
                        >
                            <div class="mcp-header">
                                <div class="mcp-name-group">
                                    <span class="mcp-name">{{ key }}</span>
                                    <span class="mcp-type-tag">
                                        {{ value.type === 'local' ? '本地 (Stdio)' : 'HTTP (SSE)' }}
                                    </span>
                                </div>
                                <div class="mcp-header-actions">
                                    <span class="mcp-status" :class="value.enabled ? 'enabled' : 'disabled'">
                                        {{ value.enabled ? '已启用' : '已禁用' }}
                                    </span>
                                    <InputSwitch v-model="value.enabled" />
                                    <Button
                                        icon="pi pi-trash"
                                        severity="danger"
                                        text
                                        rounded
                                        size="small"
                                        @click="removeMcp(key)"
                                        v-tooltip.top="'删除该 MCP 配置'"
                                    />
                                </div>
                            </div>
                            <div class="form-stack">
                                <div class="form-field">
                                    <label>类型</label>
                                    <Select
                                        v-model="value.type"
                                        :options="mcpTypes"
                                        optionLabel="label"
                                        optionValue="value"
                                        placeholder="选择类型"
                                        fluid
                                    />
                                </div>
                                <div class="form-field" v-if="value.type === 'local'">
                                    <label>命令 (JSON 数组)</label>
                                    <Textarea
                                        v-model="value.command"
                                        placeholder='["npx", "-y", "@modelcontextprotocol/server-filesystem", "/path/to/files"]'
                                        rows="2"
                                        fluid
                                    />
                                    <small class="field-hint">以 JSON 数组形式填写完整命令及参数</small>
                                </div>
                                <div class="form-field" v-if="value.type === 'http'">
                                    <label>URL</label>
                                    <InputText v-model="value.url" placeholder="http://localhost:3000/sse" />
                                    <small class="field-hint">指向 MCP HTTP(SSE) 服务器地址</small>
                                </div>
                                <div class="form-field">
                                    <label>环境变量 (JSON 对象)</label>
                                    <Textarea
                                        v-model="value.environment"
                                        placeholder='{"KEY": "value"}'
                                        rows="2"
                                        fluid
                                    />
                                </div>
                                <div class="form-field">
                                    <label>超时 (毫秒)</label>
                                    <InputNumber v-model="value.timeout" placeholder="120000" :useGrouping="false" />
                                </div>
                            </div>
                        </div>
                    </div>
                    <Message v-else severity="info" :closable="false">
                        暂无 MCP 服务器，点击右上角“添加服务器”创建
                    </Message>
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
import { useApi, type Config } from '../composables/useApi'
import { useToast } from 'primevue/usetoast'
import Button from 'primevue/button'
import Card from 'primevue/card'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import Select from 'primevue/select'
import InputSwitch from 'primevue/inputswitch'
import Textarea from 'primevue/textarea'
import Message from 'primevue/message'
import Toast from 'primevue/toast'
import ProgressSpinner from 'primevue/progressspinner'

const { getConfig, saveConfig: saveApiConfig } = useApi()
const toast = useToast()

const config = ref<Config | null>(null)
const loading = ref(false)
const saving = ref(false)

const mcpTypes = [
    { label: '本地 (Stdio)', value: 'local' },
    { label: 'HTTP (SSE)', value: 'http' }
]

async function loadConfig() {
    loading.value = true
    config.value = await getConfig()
    loading.value = false
}

async function saveConfig() {
    if (!config.value) return
    saving.value = true
    const success = await saveApiConfig(config.value)
    saving.value = false
    if (success) {
        toast.add({ severity: 'success', summary: '成功', detail: '配置已保存', life: 3000 })
    } else {
        toast.add({ severity: 'error', summary: '错误', detail: '保存失败', life: 3000 })
    }
}

function addMcp() {
    if (!config.value) return
    if (!config.value.mcp) {
        config.value.mcp = {}
    }
    const newName = `mcp${Object.keys(config.value.mcp).length + 1}`
    config.value.mcp[newName] = {
        type: 'local',
        command: '["npx", "-y", "@modelcontextprotocol/server-filesystem", "/path/to/files"]',
        environment: '{}',
        enabled: true,
        timeout: 120000
    }
}

function removeMcp(key: string) {
    if (!config.value?.mcp) return
    delete config.value.mcp[key]
}

onMounted(() => {
    loadConfig()
})
</script>

<style scoped>
.mcp-page {
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

.mcp-sections {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.mcp-card {
    margin-bottom: 0;
}

.mcp-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.form-stack {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
}

.form-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.form-field label {
    font-size: 14px;
    font-weight: 500;
    color: #475569;
}

.field-hint {
    font-size: 12px;
    color: #94a3b8;
    margin-top: 2px;
}

.section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
}

.section-title-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.section-title {
    font-size: 16px;
    font-weight: 600;
}

.section-subtitle {
    font-size: 13px;
    color: #94a3b8;
}

.mcp-section {
    padding: 14px 16px;
    background: #f8fafc;
    border-radius: 12px;
    border: 1px solid #e2e8f0;
    transition: box-shadow 0.2s ease, transform 0.1s ease, border-color 0.2s ease, background-color 0.2s ease;
}

.mcp-section:last-child {
    margin-bottom: 0;
}

.mcp-section:hover {
    box-shadow: 0 6px 18px rgba(15, 23, 42, 0.08);
    transform: translateY(-1px);
    border-color: #bfdbfe;
    background: #eff6ff;
}

.mcp-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
    gap: 12px;
}

.mcp-name-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.mcp-name {
    font-weight: 600;
    font-size: 15px;
}

.mcp-type-tag {
    font-size: 12px;
    color: #64748b;
}

.mcp-header-actions {
    display: inline-flex;
    align-items: center;
    gap: 8px;
}

.mcp-status {
    font-size: 12px;
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid transparent;
}

.mcp-status.enabled {
    background: #dcfce7;
    color: #15803d;
    border-color: #bbf7d0;
}

.mcp-status.disabled {
    background: #fee2e2;
    color: #b91c1c;
    border-color: #fecaca;
}

.loading-container {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 48px;
}

@media (max-width: 768px) {
    .form-stack {
        grid-template-columns: 1fr;
    }

    .mcp-header {
        flex-direction: column;
        align-items: flex-start;
    }

    .mcp-header-actions {
        align-self: stretch;
        justify-content: flex-start;
    }
}

@media (prefers-color-scheme: dark) {
    .form-field label {
        color: #94a3b8;
    }
    .mcp-section {
        background: #1e293b;
        border-color: #334155;
    }
}
</style>
