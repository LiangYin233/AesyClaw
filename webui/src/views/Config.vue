<template>
    <div class="config-page">
        <div class="page-header">
            <h1>配置管理</h1>
            <div class="header-actions">
                <Button label="刷新" icon="pi pi-refresh" outlined @click="loadConfig" :loading="loading" />
                <Button label="保存" icon="pi pi-save" @click="saveConfig" :loading="saving" :disabled="!config" />
            </div>
        </div>
        
        <div v-if="config" class="config-sections">
            <Card class="config-card">
                <template #title>服务器配置</template>
                <template #content>
                    <div class="form-grid">
                        <div v-for="(value, key) in config.server" :key="key" class="form-field">
                            <label class="capitalize">{{ formatLabel(key) }}</label>
                            <InputNumber 
                                v-if="isNumber(value)" 
                                v-model="config.server[key]" 
                                :useGrouping="false" 
                            />
                            <InputText v-else v-model="config.server[key]" />
                        </div>
                    </div>
                </template>
            </Card>
            
            <Card class="config-card">
                <template #title>Agent 默认配置</template>
                <template #content>
                    <div class="form-grid">
                        <div v-for="(value, key) in config.agent.defaults" :key="key" class="form-field">
                            <label class="capitalize">{{ formatLabel(key) }}</label>
                            <template v-if="key === 'provider'">
                                <Select v-model="config.agent.defaults[key]" :options="providerKeys" placeholder="选择提供商" />
                            </template>
                            <template v-else-if="key === 'contextMode'">
                                <Select v-model="config.agent.defaults[key]" :options="['session', 'channel', 'global']" placeholder="选择模式" />
                            </template>
                            <InputNumber 
                                v-else-if="isNumber(value)" 
                                v-model="config.agent.defaults[key]" 
                                :useGrouping="false" 
                            />
                            <Textarea v-else-if="isLongString(value)" v-model="config.agent.defaults[key]" rows="3" fluid />
                            <InputText v-else v-model="config.agent.defaults[key]" />
                        </div>
                    </div>
                </template>
            </Card>
            
            <Card class="config-card">
                <template #title>通道配置</template>
                <template #content>
                    <div v-for="(value, key) in config.channels" :key="key" class="channel-section">
                        <h3 class="channel-title">{{ String(key).charAt(0).toUpperCase() + String(key).slice(1) }}</h3>
                        <div class="form-grid">
                            <template v-for="(v, k) in value" :key="k">
                                <div v-if="k !== 'httpUrl'" class="form-field">
                                    <label class="capitalize">{{ k }}</label>
                                <template v-if="k === 'enabled'">
                                    <ToggleButton v-model="value[k]" onLabel="已启用" offLabel="已禁用" />
                                </template>
                                <template v-else-if="Array.isArray(v)">
                                    <InputText v-model="value[k]" placeholder="逗号分隔" />
                                </template>
                                <template v-else-if="typeof v === 'string'">
                                    <InputText v-model="value[k]" type="password" v-if="k === 'token' || k === 'apiKey'" />
                                    <InputText v-model="value[k]" v-else />
                                </template>
                                <template v-else>
                                    <InputText v-model="value[k]" />
                                </template>
                                </div>
                            </template>
                        </div>
                    </div>
                </template>
            </Card>
            
            <Card class="config-card">
                <template #title>
                    <div class="section-header">
                        <span>提供商配置</span>
                        <Button label="添加" icon="pi pi-plus" size="small" @click="addProvider" />
                    </div>
                </template>
                <template #content>
                    <div v-if="Object.keys(config.providers).length > 0">
                        <div v-for="(value, key) in config.providers" :key="key" class="provider-section">
                            <div class="provider-header">
                                <span class="provider-name">{{ key }}</span>
                                <Button icon="pi pi-trash" severity="danger" text rounded size="small" @click="removeProvider(key)" />
                            </div>
                            <div class="form-grid">
                                <div class="form-field">
                                    <label>API Key</label>
                                    <Password v-model="value.apiKey" placeholder="留空保持原值" :feedback="false" toggleMask fluid />
                                </div>
                                <div class="form-field">
                                    <label>API Base</label>
                                    <InputText v-model="value.apiBase" placeholder="https://api.example.com" />
                                </div>
                            </div>
                        </div>
                    </div>
                    <Message v-else severity="info" :closable="false">
                        暂无提供商，点击上方添加
                    </Message>
                </template>
            </Card>
            
            <Card class="config-card">
                <template #title>
                    <div class="section-header">
                        <span>MCP 服务器配置</span>
                        <Button label="添加" icon="pi pi-plus" size="small" @click="addMcp" />
                    </div>
                </template>
                <template #content>
                    <div v-if="config.mcp && Object.keys(config.mcp).length > 0">
                        <div v-for="(value, key) in config.mcp" :key="key" class="mcp-section">
                            <div class="mcp-header">
                                <span class="mcp-name">{{ key }}</span>
                                <Button icon="pi pi-trash" severity="danger" text rounded size="small" @click="removeMcp(key)" />
                            </div>
                            <div class="form-stack">
                                <div class="form-field">
                                    <label>命令</label>
                                    <InputText v-model="value.command" placeholder="npx" />
                                </div>
                                <div class="form-field">
                                    <label>参数 (JSON数组格式)</label>
                                    <Textarea v-model="value.args" placeholder='["-y", "@modelcontextprotocol/server-filesystem", "/path/to/files"]' rows="2" fluid />
                                </div>
                                <div class="form-field">
                                    <label>或 HTTP URL</label>
                                    <InputText v-model="value.url" placeholder="http://localhost:3000/sse" />
                                </div>
                            </div>
                        </div>
                    </div>
                    <Message v-else severity="info" :closable="false">
                        暂无 MCP 服务器，点击上方添加
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
import { ref, computed, onMounted } from 'vue'
import { useApi, type Config } from '../composables/useApi'
import { useToast } from 'primevue/usetoast'
import Button from 'primevue/button'
import Card from 'primevue/card'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import Select from 'primevue/select'
import ToggleButton from 'primevue/togglebutton'
import Password from 'primevue/password'
import Textarea from 'primevue/textarea'
import Message from 'primevue/message'
import Toast from 'primevue/toast'
import ProgressSpinner from 'primevue/progressspinner'

const { getConfig, saveConfig: saveApiConfig } = useApi()
const toast = useToast()

const config = ref<Config | null>(null)
const loading = ref(false)
const saving = ref(false)

const providerKeys = computed(() => {
    return config.value ? Object.keys(config.value.providers) : []
})

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

function formatLabel(key: string): string {
    return key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())
}

function isNumber(value: any): boolean {
    return typeof value === 'number'
}

function isLongString(value: any): boolean {
    return typeof value === 'string' && value.length > 100
}

function addProvider() {
    if (!config.value) return
    const newName = `provider${Object.keys(config.value.providers).length + 1}`
    config.value.providers[newName] = { apiKey: '', apiBase: '' }
}

function removeProvider(key: string) {
    if (!config.value) return
    delete config.value.providers[key]
}

function addMcp() {
    if (!config.value) return
    if (!config.value.mcp) {
        config.value.mcp = {}
    }
    const newName = `mcp${Object.keys(config.value.mcp).length + 1}`
    config.value.mcp[newName] = { command: 'npx', args: '[]', url: '' }
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
.config-page {
    padding: 24px;
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

.config-sections {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.config-card {
    margin-bottom: 0;
}

.form-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 16px;
}

.form-stack {
    display: flex;
    flex-direction: column;
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

.capitalize {
    text-transform: capitalize;
}

.channel-section {
    margin-bottom: 16px;
}

.channel-section:last-child {
    margin-bottom: 0;
}

.channel-title {
    font-size: 16px;
    font-weight: 500;
    margin: 0 0 12px 0;
    padding-left: 12px;
    border-left: 3px solid #3b82f6;
}

.section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
}

.provider-section,
.mcp-section {
    padding: 12px;
    background: #f8fafc;
    border-radius: 8px;
    margin-bottom: 12px;
}

.provider-section:last-child,
.mcp-section:last-child {
    margin-bottom: 0;
}

.provider-header,
.mcp-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
}

.provider-name,
.mcp-name {
    font-weight: 500;
}

.loading-container {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 48px;
}

@media (prefers-color-scheme: dark) {
    .form-field label {
        color: #94a3b8;
    }
    .provider-section,
    .mcp-section {
        background: #1e293b;
    }
}
</style>
