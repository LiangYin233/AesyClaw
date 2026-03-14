<template>
    <div class="config-page page-stack">
        <PageHeader title="配置管理" subtitle="集中编辑全局运行参数、服务端配置与 Provider 配置。">
            <template #actions>
                <Button label="刷新" icon="pi pi-refresh" outlined @click="loadConfig" :loading="loading" />
                <Button label="保存" icon="pi pi-save" @click="saveConfig" :loading="saving" :disabled="!config" />
            </template>
        </PageHeader>
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
                            <ToggleButton
                                v-else-if="isBoolean(value)"
                                v-model="config.server[key]"
                                onLabel="已启用"
                                offLabel="已禁用"
                            />
                            <Password v-else-if="key === 'token'" v-model="config.server[key]" :feedback="false" toggleMask fluid />
                            <InputText v-else v-model="config.server[key]" />
                        </div>
                    </div>
                </template>
            </Card>
            
            <Card class="config-card">
                <template #title>Agent 全局运行配置</template>
                <template #content>
                    <Message severity="info" :closable="false" class="config-hint">
                        Agent 的 Provider、Model、System Prompt、Vision 与 Reasoning 已迁移到 Agent 页面管理；工具迭代上限仍在当前页统一配置。
                        <Button label="前往 Agent 页面" link size="small" @click="goToAgents" />
                    </Message>
                    <div class="form-grid">
                        <template v-for="(value, key) in config.agent.defaults" :key="key">
                            <div v-if="!isAgentConfigHidden(String(key))" class="form-field">
                                <label class="capitalize">{{ formatLabel(key) }}</label>
                                <template v-if="key === 'contextMode'">
                                    <Select v-model="config.agent.defaults[key]" :options="['session', 'channel', 'global']" placeholder="选择模式" />
                                </template>
                                <InputNumber 
                                    v-else-if="isNumber(value)" 
                                    v-model="config.agent.defaults[key]" 
                                    :useGrouping="false" 
                                />
                                <ToggleButton
                                    v-else-if="isBoolean(value)"
                                    v-model="config.agent.defaults[key]"
                                    onLabel="已启用"
                                    offLabel="已禁用"
                                />
                                <Textarea v-else-if="isLongString(value)" v-model="config.agent.defaults[key]" rows="3" fluid />
                                <InputText v-else v-model="config.agent.defaults[key]" />
                            </div>
                        </template>
                    </div>
                    <div class="nested-configs">
                        <div class="nested-config-section">
                            <h3 class="nested-config-title">Memory Summary</h3>
                            <div class="form-grid">
                                <div class="form-field">
                                    <label>Enabled</label>
                                    <ToggleButton
                                        v-model="config.agent.defaults.memorySummary.enabled"
                                        onLabel="已启用"
                                        offLabel="已禁用"
                                    />
                                </div>
                                <div class="form-field">
                                    <label>Provider</label>
                                    <Select
                                        v-model="config.agent.defaults.memorySummary.provider"
                                        :options="providerKeys"
                                        placeholder="选择提供商"
                                    />
                                </div>
                                <div class="form-field">
                                    <label>Model</label>
                                    <InputText v-model="config.agent.defaults.memorySummary.model" />
                                </div>
                                <div class="form-field">
                                    <label>Trigger Messages</label>
                                    <InputNumber
                                        v-model="config.agent.defaults.memorySummary.triggerMessages"
                                        :useGrouping="false"
                                        :min="1"
                                    />
                                </div>
                            </div>
                        </div>
                        <div class="nested-config-section">
                            <h3 class="nested-config-title">Memory Facts</h3>
                            <div class="form-grid">
                                <div class="form-field">
                                    <label>Enabled</label>
                                    <ToggleButton
                                        v-model="config.agent.defaults.memoryFacts.enabled"
                                        onLabel="已启用"
                                        offLabel="已禁用"
                                    />
                                </div>
                                <div class="form-field">
                                    <label>Provider</label>
                                    <Select
                                        v-model="config.agent.defaults.memoryFacts.provider"
                                        :options="providerKeys"
                                        placeholder="选择提供商"
                                    />
                                </div>
                                <div class="form-field">
                                    <label>Model</label>
                                    <InputText v-model="config.agent.defaults.memoryFacts.model" />
                                </div>
                                <div class="form-field">
                                    <label>Max Facts</label>
                                    <InputNumber
                                        v-model="config.agent.defaults.memoryFacts.maxFacts"
                                        :useGrouping="false"
                                        :min="1"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </template>
            </Card>
            
            <Card class="config-card">
                <template #title>通道配置</template>
                <template #content>
                    <Message severity="info" :closable="false" class="config-hint">
                        通道配置已迁移到插件页面，与其他插件使用统一的管理方式。
                        <Button label="前往插件页面" link size="small" @click="goToPlugins" />
                    </Message>
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
            
        </div>
        
        <div v-else-if="loading" class="loading-container">
            <ProgressSpinner />
        </div>
        
        <Toast />
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useConfigStore } from '../stores'
import { useRoute, useRouter } from 'vue-router'
import { getRouteToken, navigateWithToken } from '../utils/auth'
import { useToast } from 'primevue/usetoast'
import Button from 'primevue/button'
import Card from 'primevue/card'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import ToggleButton from 'primevue/togglebutton'
import Select from 'primevue/select'
import Password from 'primevue/password'
import Textarea from 'primevue/textarea'
import Message from 'primevue/message'
import Toast from 'primevue/toast'
import ProgressSpinner from 'primevue/progressspinner'
import PageHeader from '../components/common/PageHeader.vue'

const configStore = useConfigStore()
const { config, loading } = storeToRefs(configStore)
const route = useRoute()
const router = useRouter()
const toast = useToast()
const saving = ref(false)

const providerKeys = computed(() => {
    return config.value ? Object.keys(config.value.providers) : []
})

async function loadConfig() {
    await configStore.fetchConfig()
}

async function saveConfig() {
    if (!config.value) return
    saving.value = true
    const success = await configStore.saveConfig()
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

function isBoolean(value: any): boolean {
    return typeof value === 'boolean'
}

function isLongString(value: any): boolean {
    return typeof value === 'string' && value.length > 100
}

function isAgentConfigHidden(key: string): boolean {
    return ['memorySummary', 'memoryFacts'].includes(key)
}

function goToAgents() {
    navigateWithToken(router, '/agents', getRouteToken(route))
}

function goToPlugins() {
    navigateWithToken(router, '/plugins', getRouteToken(route))
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

onMounted(() => {
    loadConfig()
})
</script>

<style scoped>
.config-page {
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

.config-sections {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.config-card {
    margin-bottom: 0;
}

.nested-configs {
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin-top: 16px;
}

.nested-config-section {
    padding: 16px;
    background: #f8fafc;
    border-radius: 8px;
}

.nested-config-title {
    margin: 0 0 12px 0;
    font-size: 16px;
    font-weight: 600;
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
    .nested-config-section,
    .provider-section,
    .mcp-section {
        background: #1e293b;
    }
}
</style>
