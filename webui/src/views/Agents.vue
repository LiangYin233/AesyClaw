<template>
    <div class="agents-page page-stack">
        <PageHeader title="Agent 编排" subtitle="集中管理主 Agent 与专用角色的模型、视觉、推理与可用能力边界。">
            <template #actions>
                <Button label="刷新" icon="pi pi-refresh" outlined @click="loadAll" :loading="agentsStore.loading" />
                <Button label="新建 Agent" icon="pi pi-plus" @click="openCreateDialog" />
            </template>
        </PageHeader>
        <div v-if="agentsStore.agents.length > 0" class="agent-summary-grid">
            <Card v-for="item in summaryCards" :key="item.label" class="summary-card">
                <template #content>
                    <div class="summary-card__label">{{ item.label }}</div>
                    <div class="summary-card__value">{{ item.value }}</div>
                    <div class="summary-card__hint">{{ item.hint }}</div>
                </template>
            </Card>
        </div>
        <div class="agents-grid" v-if="agentsStore.agents.length > 0">
            <Card v-for="agent in agentsStore.agents" :key="agent.name" class="agent-card">
                <template #title>
                    <div class="agent-title-row">
                        <div>
                            <div class="agent-name">{{ agent.name }}</div>
                            <div class="agent-desc">{{ agent.description || '无描述' }}</div>
                        </div>
                        <Tag :value="agent.builtin ? '内建' : '自定义'" :severity="agent.builtin ? 'info' : 'success'" />
                    </div>
                </template>
                <template #content>
                    <div class="agent-meta">
                        <Tag :value="`提供商 ${agent.provider}`" severity="secondary" />
                        <Tag :value="agent.model" severity="contrast" />
                        <Tag :value="`视觉 ${agent.vision ? '开启' : '关闭'}`" :severity="agent.vision ? 'success' : 'secondary'" />
                        <Tag :value="`推理 ${agent.reasoning ? '开启' : '关闭'}`" :severity="agent.reasoning ? 'warn' : 'secondary'" />
                    </div>
                    <div class="agent-capability-grid">
                        <div class="agent-capability">
                            <span class="agent-capability__label">技能数量</span>
                            <strong>{{ agent.availableSkills.length }}</strong>
                        </div>
                        <div class="agent-capability">
                            <span class="agent-capability__label">工具数量</span>
                            <strong>{{ agent.availableTools.length }}</strong>
                        </div>
                        <div class="agent-capability">
                            <span class="agent-capability__label">视觉模型</span>
                            <strong>{{ agent.visionModel || '未配置' }}</strong>
                        </div>
                        <div class="agent-capability">
                            <span class="agent-capability__label">视觉提供商</span>
                            <strong>{{ agent.visionProvider || '未配置' }}</strong>
                        </div>
                    </div>
                    <Message v-if="agent.missingSkills.length || agent.missingTools.length" severity="warn" :closable="false">
                        缺失资源：
                        <span v-if="agent.missingSkills.length">Skills {{ agent.missingSkills.join(', ') }}</span>
                        <span v-if="agent.missingSkills.length && agent.missingTools.length">；</span>
                        <span v-if="agent.missingTools.length">Tools {{ agent.missingTools.join(', ') }}</span>
                    </Message>
                    <div v-if="agent.vision" class="vision-meta">
                        <span>Vision Provider: {{ agent.visionProvider || '未配置' }}</span>
                        <span>Vision Model: {{ agent.visionModel || '未配置' }}</span>
                    </div>
                    <pre class="prompt-preview">{{ agent.systemPrompt }}</pre>
                    <div class="agent-actions">
                        <Button label="编辑" icon="pi pi-pencil" text @click="openEditDialog(agent)" />
                        <template v-if="!agent.builtin">
                            <Button label="删除" icon="pi pi-trash" severity="danger" text @click="deletingAgent = agent; deleteVisible = true" />
                        </template>
                    </div>
                </template>
            </Card>
        </div>

        <EmptyState
            v-else
            icon="pi pi-users"
            title="暂无 Agent 角色"
            description="当前仅使用内建主 Agent，请点击右上角创建自定义角色"
        >
            <template #actions>
                <Button label="新建 Agent" icon="pi pi-plus" @click="openCreateDialog" />
            </template>
        </EmptyState>

        <Dialog
            v-model:visible="dialogVisible"
            :header="editingName ? `编辑 Agent：${editingName}` : '新建 Agent'"
            modal
            class="agent-dialog"
        >
            <div class="form-stack">
                <div class="form-field">
                    <label>名称</label>
                    <InputText v-model="form.name" :disabled="!!editingName" />
                </div>
                <div class="form-field">
                    <label>描述</label>
                    <InputText v-model="form.description" />
                </div>
                <div class="form-grid">
                    <div class="form-field">
                        <label>Provider</label>
                        <Select v-model="form.provider" :options="providerOptions" placeholder="选择提供商" />
                    </div>
                    <div class="form-field">
                        <label>Model</label>
                        <InputText v-model="form.model" />
                    </div>
                </div>
                <div class="form-grid">
                    <div class="form-field">
                        <label>Vision</label>
                        <ToggleButton v-model="form.vision" onLabel="已启用" offLabel="已禁用" />
                    </div>
                    <div class="form-field">
                        <label>Reasoning</label>
                        <ToggleButton v-model="form.reasoning" onLabel="已启用" offLabel="已禁用" />
                    </div>
                </div>
                <div class="form-grid">
                    <div class="form-field">
                        <label>Vision Provider</label>
                        <Select v-model="form.visionProvider" :options="providerOptions" placeholder="选择视觉提供商" showClear />
                    </div>
                    <div class="form-field">
                        <label>Vision Model</label>
                        <InputText v-model="form.visionModel" placeholder="未配置时不会启用视觉模型" />
                    </div>
                </div>
                <div class="form-field">
                    <label>System Prompt</label>
                    <Textarea v-model="form.systemPrompt" rows="8" fluid />
                </div>
                <div class="form-field">
                    <label>允许使用的 Skills</label>
                    <MultiSelect
                        v-model="form.allowedSkills"
                        :options="skillOptions"
                        option-label="label"
                        option-value="value"
                        display="chip"
                        filter
                        :maxSelectedLabels="6"
                    />
                </div>
                <div class="form-field">
                    <label>允许使用的 Tools</label>
                    <MultiSelect
                        v-model="form.allowedTools"
                        :options="toolOptions"
                        option-label="label"
                        option-value="value"
                        display="chip"
                        filter
                        :maxSelectedLabels="6"
                    />
                </div>
            </div>
            <template #footer>
                <Button label="取消" text @click="dialogVisible = false" />
                <Button label="保存" icon="pi pi-save" @click="saveAgent" :loading="saving" />
            </template>
        </Dialog>

        <ConfirmDialog
            v-model:visible="deleteVisible"
            title="删除 Agent"
            :message="`确定要删除 Agent ${deletingAgent?.name || ''} 吗？`"
            :loading="deleting"
            confirm-label="删除"
            confirm-severity="danger"
            :on-confirm="doDelete"
        />
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useAgentsStore, useConfigStore, useSkillsStore, useToolsStore } from '../stores'
import type { AgentRole, AgentRoleConfig } from '../types/api'
import { useToast } from '../composables/useToast'
import Button from 'primevue/button'
import Card from 'primevue/card'
import Tag from 'primevue/tag'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import Select from 'primevue/select'
import MultiSelect from 'primevue/multiselect'
import Message from 'primevue/message'
import ToggleButton from 'primevue/togglebutton'
import PageHeader from '../components/common/PageHeader.vue'
import EmptyState from '../components/common/EmptyState.vue'
import ConfirmDialog from '../components/common/ConfirmDialog.vue'

const agentsStore = useAgentsStore()
const configStore = useConfigStore()
const skillsStore = useSkillsStore()
const toolsStore = useToolsStore()
const toast = useToast()

const dialogVisible = ref(false)
const deleteVisible = ref(false)
const saving = ref(false)
const deleting = ref(false)
const editingName = ref('')
const deletingAgent = ref<AgentRole | null>(null)

const form = reactive<AgentRoleConfig>({
    name: '',
    description: '',
    provider: '',
    model: '',
    systemPrompt: 'You are a helpful AI assistant.',
    vision: false,
    reasoning: false,
    visionProvider: '',
    visionModel: '',
    allowedSkills: [],
    allowedTools: []
})

const providerOptions = computed(() => Object.keys(configStore.config?.providers || {}))
const skillOptions = computed(() => skillsStore.skills.map(skill => ({ label: skill.name, value: skill.name })))
const toolOptions = computed(() => toolsStore.tools.map(tool => ({ label: tool.name, value: tool.name })))
const summaryCards = computed(() => {
    const total = agentsStore.agents.length
    const visionEnabled = agentsStore.agents.filter(agent => agent.vision).length
    const reasoningEnabled = agentsStore.agents.filter(agent => agent.reasoning).length
    const missingResources = agentsStore.agents.filter(agent => agent.missingSkills.length || agent.missingTools.length).length

    return [
        { label: '角色总数', value: String(total), hint: '包含内建与自定义角色' },
        { label: '已启用视觉', value: String(visionEnabled), hint: '支持图像或截图输入' },
        { label: '已启用推理', value: String(reasoningEnabled), hint: '适合复杂规划任务' },
        { label: '需关注角色', value: String(missingResources), hint: '存在缺失技能或工具引用' }
    ]
})

function getMainAgentTemplate(): AgentRoleConfig {
    const main = configStore.config?.agents.roles.main

    return {
        name: '',
        description: main?.description || '',
        provider: main?.provider || providerOptions.value[0] || 'openai',
        model: main?.model || '',
        systemPrompt: main?.systemPrompt || 'You are a helpful AI assistant.',
        vision: main?.vision ?? false,
        reasoning: main?.reasoning ?? false,
        visionProvider: main?.visionProvider || '',
        visionModel: main?.visionModel || '',
        allowedSkills: [...(main?.allowedSkills || [])],
        allowedTools: [...(main?.allowedTools || [])]
    }
}

function resetForm() {
    const template = getMainAgentTemplate()
    form.name = ''
    form.description = template.description
    form.provider = template.provider
    form.model = template.model
    form.systemPrompt = template.systemPrompt
    form.vision = template.vision
    form.reasoning = template.reasoning
    form.visionProvider = template.visionProvider
    form.visionModel = template.visionModel
    form.allowedSkills = [...template.allowedSkills]
    form.allowedTools = [...template.allowedTools]
}

async function loadAll() {
    await Promise.all([
        agentsStore.fetchAgents(),
        configStore.fetchConfig(),
        skillsStore.fetchSkills(),
        toolsStore.fetchTools()
    ])

    if (!editingName.value && !form.provider) {
        resetForm()
    }
}

function openCreateDialog() {
    editingName.value = ''
    resetForm()
    dialogVisible.value = true
}

function openEditDialog(agent: AgentRole) {
    editingName.value = agent.name
    form.name = agent.name
    form.description = agent.description || ''
    form.provider = agent.provider
    form.model = agent.model
    form.systemPrompt = agent.systemPrompt
    form.vision = agent.vision
    form.reasoning = agent.reasoning
    form.visionProvider = agent.visionProvider || ''
    form.visionModel = agent.visionModel || ''
    form.allowedSkills = [...agent.allowedSkills]
    form.allowedTools = [...agent.allowedTools]
    dialogVisible.value = true
}

async function saveAgent() {
    saving.value = true
    const payload: AgentRoleConfig = {
        name: form.name.trim(),
        description: form.description.trim(),
        provider: form.provider,
        model: form.model.trim(),
        systemPrompt: form.systemPrompt,
        vision: form.vision,
        reasoning: form.reasoning,
        visionProvider: form.visionProvider || '',
        visionModel: form.visionModel.trim(),
        allowedSkills: [...form.allowedSkills],
        allowedTools: [...form.allowedTools]
    }

    const result = editingName.value
        ? await agentsStore.updateAgent(editingName.value, payload)
        : await agentsStore.createAgent(payload)

    saving.value = false

    if (!result) {
        toast.error('保存失败', agentsStore.error || '无法保存 Agent 角色')
        return
    }

    toast.success('保存成功', `Agent 角色 ${result.name} 已保存`)
    dialogVisible.value = false
}

async function doDelete() {
    if (!deletingAgent.value) {
        return
    }

    deleting.value = true
    const success = await agentsStore.deleteAgent(deletingAgent.value.name)
    deleting.value = false

    if (!success) {
        toast.error('删除失败', agentsStore.error || '无法删除 Agent 角色')
        return
    }

    toast.success('删除成功', `Agent 角色 ${deletingAgent.value.name} 已删除`)
    deleteVisible.value = false
    deletingAgent.value = null
}

onMounted(() => {
    loadAll()
})
</script>

<style scoped>
.agents-page {
    padding: 0;
}

.agents-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
    gap: 16px;
}

.agent-summary-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 16px;
}

.summary-card__label {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ui-text-faint);
}

.summary-card__value {
    margin-top: 8px;
    font-size: 32px;
    font-weight: 800;
    color: var(--ui-text-strong);
}

.summary-card__hint {
    margin-top: 6px;
    color: var(--ui-text-muted);
    font-size: 13px;
}

.agent-card {
    height: 100%;
}

.agent-title-row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
}

.agent-name {
    font-size: 18px;
    font-weight: 700;
}

.agent-desc {
    margin-top: 4px;
    color: var(--ui-text-muted);
    font-size: 13px;
}

.agent-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 12px;
}

.agent-capability-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    margin-bottom: 12px;
}

.agent-capability {
    padding: 12px;
    border-radius: 12px;
    border: 1px solid var(--ui-border-subtle);
    background: var(--ui-panel-alt);
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.agent-capability__label {
    font-size: 12px;
    color: var(--ui-text-faint);
}

.vision-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-bottom: 12px;
    font-size: 13px;
    color: var(--ui-text-muted);
}

.prompt-preview {
    white-space: pre-wrap;
    background: var(--ui-panel-alt);
    border: 1px solid var(--ui-border);
    border-radius: 8px;
    padding: 12px;
    min-height: 140px;
    max-height: 260px;
    overflow: auto;
    font-size: 13px;
}

.agent-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 12px;
}

.agent-dialog {
    width: 760px;
    max-width: 92vw;
}

.agent-dialog :deep(.p-dialog-content) {
    max-height: 75vh;
    overflow-y: auto;
}

.form-stack {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.form-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 16px;
}

.form-field {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

@media (max-width: 768px) {
    .agent-capability-grid {
        grid-template-columns: 1fr;
    }
}
</style>
