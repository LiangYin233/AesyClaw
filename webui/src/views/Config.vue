<template>
    <div class="config-page page-stack">
        <PageHeader title="系统设置" subtitle="集中编辑全局运行参数、服务端配置与 Provider 配置。">
            <template #actions>
                <Button label="刷新" icon="pi pi-refresh" outlined @click="configStore.fetchConfig()" :loading="loading" />
                <Button label="保存" icon="pi pi-save" @click="saveConfig" :loading="saving" :disabled="!config" />
            </template>
        </PageHeader>
        <div v-if="config" class="config-sections">
            <Card class="config-card">
                <template #title>服务器配置</template>
                <template #content>
                    <div class="form-grid">
                        <div
                            v-for="field in serverSection.fields"
                            :key="field.key"
                            class="form-field"
                            :class="{ 'form-field--full': field.fullWidth }"
                        >
                            <label>{{ field.label }}</label>
                            <component
                                :is="getFieldComponent(field)"
                                v-bind="getFieldProps(field)"
                                :modelValue="getFieldValue(field.path)"
                                @update:modelValue="setFieldValue(field.path, $event)"
                            />
                            <small v-if="field.description" class="field-hint">{{ field.description }}</small>
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
                    <div class="nested-configs">
                        <div
                            v-for="section in agentSections"
                            :key="section.key"
                            class="nested-config-section"
                        >
                            <h3 class="nested-config-title">{{ section.title }}</h3>
                            <div class="form-grid">
                                <div
                                    v-for="field in section.fields"
                                    :key="field.key"
                                    class="form-field"
                                    :class="{ 'form-field--full': field.fullWidth }"
                                >
                                    <label>{{ field.label }}</label>
                                    <component
                                        :is="getFieldComponent(field)"
                                        v-bind="getFieldProps(field)"
                                        :modelValue="getFieldValue(field.path)"
                                        @update:modelValue="setFieldValue(field.path, $event)"
                                    />
                                    <small v-if="field.description" class="field-hint">{{ field.description }}</small>
                                </div>
                            </div>
                        </div>
                    </div>
                </template>
            </Card>

            <Card class="config-card">
                <template #title>运行与日志</template>
                <template #content>
                    <div class="nested-configs nested-configs--tight">
                        <div
                            v-for="section in runtimeSections"
                            :key="section.key"
                            class="nested-config-section"
                        >
                            <h3 class="nested-config-title">{{ section.title }}</h3>
                            <div class="form-grid">
                                <div
                                    v-for="field in section.fields"
                                    :key="field.key"
                                    class="form-field"
                                    :class="{ 'form-field--full': field.fullWidth }"
                                >
                                    <label>{{ field.label }}</label>
                                    <component
                                        :is="getFieldComponent(field)"
                                        v-bind="getFieldProps(field)"
                                        :modelValue="getFieldValue(field.path)"
                                        @update:modelValue="setFieldValue(field.path, $event)"
                                    />
                                    <small v-if="field.description" class="field-hint">{{ field.description }}</small>
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
                                    <label>Type</label>
                                    <Select v-model="value.type" :options="providerTypeOptions" placeholder="选择 Provider 类型" />
                                </div>
                                <div class="form-field">
                                    <label>API Key</label>
                                    <Password v-model="value.apiKey" placeholder="留空保持原值" :feedback="false" toggleMask fluid />
                                </div>
                                <div class="form-field">
                                    <label>API Base</label>
                                    <InputText v-model="value.apiBase" placeholder="https://api.example.com" />
                                </div>
                                <div class="form-field form-field--full">
                                    <label>Headers (JSON)</label>
                                    <Textarea
                                        :modelValue="formatJsonObject(value.headers)"
                                        rows="4"
                                        fluid
                                        placeholder="{&quot;X-Test&quot;:&quot;value&quot;}"
                                        @update:modelValue="updateProviderJsonField(key, 'headers', $event)"
                                    />
                                    <small class="field-hint">额外请求头，留空表示不传。</small>
                                </div>
                                <div class="form-field form-field--full">
                                    <label>Extra Body (JSON)</label>
                                    <Textarea
                                        :modelValue="formatJsonObject(value.extraBody)"
                                        rows="5"
                                        fluid
                                        placeholder="{&quot;max_tokens&quot;:2048}"
                                        @update:modelValue="updateProviderJsonField(key, 'extraBody', $event)"
                                    />
                                    <small class="field-hint">透传给 Provider 原生 API 的额外请求体字段。</small>
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
import { useRoute, useRouter } from 'vue-router'
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
import { useConfigStore } from '../stores'
import { getRouteToken, navigateWithToken } from '../utils/auth'

type ConfigFieldType = 'text' | 'number' | 'boolean' | 'password' | 'textarea' | 'select'
type OptionSourceKey = 'contextModes' | 'providerKeys' | 'embeddingProviders' | 'logLevels'

interface ConfigFieldDescriptor {
    key: string
    label: string
    path: string[]
    type: ConfigFieldType
    description?: string
    fullWidth?: boolean
    placeholder?: string
    rows?: number
    min?: number
    max?: number
    step?: number
    minFractionDigits?: number
    maxFractionDigits?: number
    options?: string[]
    optionsKey?: OptionSourceKey
}

interface ConfigSectionDescriptor {
    key: string
    title: string
    fields: ConfigFieldDescriptor[]
}

const configStore = useConfigStore()
const { config, loading } = storeToRefs(configStore)
const route = useRoute()
const router = useRouter()
const toast = useToast()
const saving = ref(false)

const providerKeys = computed(() => config.value ? Object.keys(config.value.providers) : [])
const retrievalProviderKeys = computed(() => {
    if (!config.value) return []
    return Object.entries(config.value.providers)
        .filter(([, provider]) => provider.type === 'openai')
        .map(([name]) => name)
})

const providerTypeOptions = ['openai', 'openai_responses', 'anthropic']
const contextModeOptions = ['session', 'channel']
const logLevelOptions = ['debug', 'info', 'warn', 'error']

const serverSection: ConfigSectionDescriptor = {
    key: 'server',
    title: '服务器配置',
    fields: [
        { key: 'host', label: 'Host', path: ['server', 'host'], type: 'text' },
        { key: 'apiPort', label: 'API Port', path: ['server', 'apiPort'], type: 'number', min: 1 },
        { key: 'apiEnabled', label: 'API Enabled', path: ['server', 'apiEnabled'], type: 'boolean' },
        { key: 'token', label: 'Token', path: ['server', 'token'], type: 'password' }
    ]
}

const agentSections: ConfigSectionDescriptor[] = [
    {
        key: 'agent-runtime',
        title: 'Agent Runtime',
        fields: [
            {
                key: 'maxToolIterations',
                label: 'Max Tool Iterations',
                path: ['agent', 'defaults', 'maxToolIterations'],
                type: 'number',
                min: 1
            },
            {
                key: 'memoryWindow',
                label: 'Memory Window',
                path: ['agent', 'defaults', 'memoryWindow'],
                type: 'number',
                min: 1,
                description: '控制 recent history 保留的对话轮次数。'
            },
            {
                key: 'maxSessions',
                label: 'Max Sessions',
                path: ['agent', 'defaults', 'maxSessions'],
                type: 'number',
                min: 1
            },
            {
                key: 'contextMode',
                label: 'Context Mode',
                path: ['agent', 'defaults', 'contextMode'],
                type: 'select',
                optionsKey: 'contextModes'
            }
        ]
    },
    {
        key: 'memory-summary',
        title: '会话摘要',
        fields: [
            {
                key: 'summary-enabled',
                label: '启用摘要',
                path: ['agent', 'defaults', 'memorySummary', 'enabled'],
                type: 'boolean'
            },
            {
                key: 'summary-provider',
                label: 'Provider',
                path: ['agent', 'defaults', 'memorySummary', 'provider'],
                type: 'select',
                optionsKey: 'providerKeys'
            },
            {
                key: 'summary-model',
                label: 'Model',
                path: ['agent', 'defaults', 'memorySummary', 'model'],
                type: 'text'
            },
            {
                key: 'summary-compress-rounds',
                label: '压缩轮数',
                path: ['agent', 'defaults', 'memorySummary', 'compressRounds'],
                type: 'number',
                min: 1,
                description: '当未摘要对话轮次超出 memoryWindow 时，压缩最早的若干轮。'
            }
        ]
    },
    {
        key: 'memory-facts-maintenance',
        title: '长期记忆维护',
        fields: [
            {
                key: 'facts-enabled',
                label: '启用长期记忆',
                path: ['agent', 'defaults', 'memoryFacts', 'enabled'],
                type: 'boolean'
            },
            {
                key: 'facts-provider',
                label: 'Provider',
                path: ['agent', 'defaults', 'memoryFacts', 'provider'],
                type: 'select',
                optionsKey: 'providerKeys'
            },
            {
                key: 'facts-model',
                label: 'Model',
                path: ['agent', 'defaults', 'memoryFacts', 'model'],
                type: 'text',
                description: '用于长期记忆的后台维护与归纳。'
            }
        ]
    },
    {
        key: 'memory-facts-recall',
        title: '长期记忆自动召回',
        fields: [
            {
                key: 'facts-retrieval-provider',
                label: 'Retrieval Provider',
                path: ['agent', 'defaults', 'memoryFacts', 'retrievalProvider'],
                type: 'select',
                optionsKey: 'embeddingProviders',
                description: '仅允许选择 type 为 openai 的 Provider。'
            },
            {
                key: 'facts-retrieval-model',
                label: 'Retrieval Model',
                path: ['agent', 'defaults', 'memoryFacts', 'retrievalModel'],
                type: 'text',
                description: '用于 embeddings 检索，不影响长期记忆后台维护模型。'
            },
            {
                key: 'facts-retrieval-threshold',
                label: 'Retrieval Threshold',
                path: ['agent', 'defaults', 'memoryFacts', 'retrievalThreshold'],
                type: 'number',
                min: 0,
                max: 1,
                step: 0.01,
                minFractionDigits: 0,
                maxFractionDigits: 4,
                description: '仅注入相似度大于等于该阈值的长期记忆。'
            },
            {
                key: 'facts-retrieval-topk',
                label: 'Retrieval TopK',
                path: ['agent', 'defaults', 'memoryFacts', 'retrievalTopK'],
                type: 'number',
                min: 1,
                max: 20,
                description: '最多向 Prompt 注入多少条相关长期记忆。'
            }
        ]
    }
]

const runtimeSections: ConfigSectionDescriptor[] = [
    {
        key: 'observability',
        title: '日志',
        fields: [
            {
                key: 'observability-level',
                label: '日志级别',
                path: ['observability', 'level'],
                type: 'select',
                optionsKey: 'logLevels'
            }
        ]
    },
    {
        key: 'tools',
        title: '工具运行',
        fields: [
            {
                key: 'tools-timeout',
                label: '工具超时 (ms)',
                path: ['tools', 'timeoutMs'],
                type: 'number',
                min: 1000,
                description: '统一控制工具执行超时时间。'
            }
        ]
    }
]

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

function getFieldComponent(field: ConfigFieldDescriptor) {
    switch (field.type) {
        case 'number':
            return InputNumber
        case 'boolean':
            return ToggleButton
        case 'password':
            return Password
        case 'textarea':
            return Textarea
        case 'select':
            return Select
        default:
            return InputText
    }
}

function getFieldProps(field: ConfigFieldDescriptor) {
    if (field.type === 'number') {
        return {
            useGrouping: false,
            min: field.min,
            max: field.max,
            step: field.step,
            minFractionDigits: field.minFractionDigits,
            maxFractionDigits: field.maxFractionDigits
        }
    }

    if (field.type === 'boolean') {
        return {
            onLabel: '已启用',
            offLabel: '已禁用'
        }
    }

    if (field.type === 'password') {
        return {
            feedback: false,
            toggleMask: true,
            fluid: true,
            placeholder: field.placeholder
        }
    }

    if (field.type === 'textarea') {
        return {
            rows: field.rows ?? 3,
            fluid: true,
            placeholder: field.placeholder
        }
    }

    if (field.type === 'select') {
        return {
            options: resolveFieldOptions(field),
            placeholder: field.placeholder ?? '请选择'
        }
    }

    return {
        placeholder: field.placeholder
    }
}

function resolveFieldOptions(field: ConfigFieldDescriptor): string[] {
    if (field.options) return field.options

    switch (field.optionsKey) {
        case 'contextModes':
            return contextModeOptions
        case 'providerKeys':
            return providerKeys.value
        case 'embeddingProviders':
            return retrievalProviderKeys.value
        case 'logLevels':
            return logLevelOptions
        default:
            return []
    }
}

function getFieldValue(path: string[]): any {
    if (!config.value) return undefined

    return path.reduce<any>((current, key) => current?.[key], config.value)
}

function setFieldValue(path: string[], value: any) {
    if (!config.value || path.length === 0) return

    let current: Record<string, any> = config.value as Record<string, any>
    for (const key of path.slice(0, -1)) {
        const nextValue = current[key]
        if (!nextValue || typeof nextValue !== 'object' || Array.isArray(nextValue)) {
            current[key] = {}
        }
        current = current[key] as Record<string, any>
    }

    current[path[path.length - 1]] = value
}

function formatJsonObject(value: Record<string, any> | undefined): string {
    if (!value || Object.keys(value).length === 0) {
        return ''
    }

    return JSON.stringify(value, null, 2)
}

function updateProviderJsonField(
    providerName: string,
    field: 'headers' | 'extraBody',
    rawValue: string
) {
    if (!config.value) return
    const provider = config.value.providers[providerName]
    if (!provider) return

    const trimmed = rawValue.trim()
    if (!trimmed) {
        delete provider[field]
        return
    }

    try {
        const parsed = JSON.parse(trimmed)
        if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
            return
        }

        provider[field] = parsed as any
    } catch {
        // Keep the last valid object until the user finishes editing valid JSON.
    }
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
    config.value.providers[newName] = { type: 'openai', apiKey: '', apiBase: '' }
}

function removeProvider(key: string) {
    if (!config.value) return
    delete config.value.providers[key]
}

onMounted(() => {
    configStore.fetchConfig()
})
</script>

<style scoped>
.config-page {
    padding: 0;
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

.nested-configs--tight {
    margin-top: 0;
}

.nested-config-section {
    padding: 16px;
    background: var(--ui-surface-muted);
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

.form-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.form-field--full {
    grid-column: 1 / -1;
}

.form-field label {
    font-size: 14px;
    font-weight: 500;
    color: var(--ui-text-soft);
}

.field-hint {
    font-size: 12px;
    color: var(--ui-text-muted);
}

.section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
}

.provider-section {
    padding: 12px;
    background: var(--ui-surface-muted);
    border-radius: 8px;
    margin-bottom: 12px;
}

.provider-section:last-child {
    margin-bottom: 0;
}

.provider-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
}

.provider-name {
    font-weight: 500;
}

.loading-container {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 48px;
}

@media (max-width: 768px) {
    .form-grid {
        grid-template-columns: 1fr;
    }
}
</style>
