<template>
    <div class="agents-page page-stack">
        <PageHeader title="Agent 角色" subtitle="管理主 Agent 与可调用的子 Agent 角色。">
            <template #actions>
                <Button label="刷新" icon="pi pi-refresh" outlined @click="loadAll" :loading="agentsStore.loading" />
                <Button label="新建 Agent" icon="pi pi-plus" @click="openCreateDialog" />
            </template>
        </PageHeader>
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
                        <Tag :value="`Provider: ${agent.provider}`" severity="secondary" />
                        <Tag :value="`Model: ${agent.model}`" severity="contrast" />
                        <Tag :value="`Skills: ${agent.availableSkills.length}`" severity="info" />
                        <Tag :value="`Tools: ${agent.availableTools.length}`" severity="warn" />
                    </div>
                    <Message v-if="agent.missingSkills.length || agent.missingTools.length" severity="warn" :closable="false">
                        缺失资源：
                        <span v-if="agent.missingSkills.length">Skills {{ agent.missingSkills.join(', ') }}</span>
                        <span v-if="agent.missingSkills.length && agent.missingTools.length">；</span>
                        <span v-if="agent.missingTools.length">Tools {{ agent.missingTools.join(', ') }}</span>
                    </Message>
                    <pre class="prompt-preview">{{ agent.systemPrompt }}</pre>
                    <div class="agent-actions">
                        <Button label="编辑" icon="pi pi-pencil" text @click="openEditDialog(agent)" />
                        <template v-if="!agent.builtin">
                            <Button label="删除" icon="pi pi-trash" severity="danger" text @click="confirmDelete(agent)" />
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

        <Dialog v-model:visible="deleteVisible" header="删除 Agent" modal>
            <p>确定要删除 Agent <strong>{{ deletingAgent?.name }}</strong> 吗？</p>
            <template #footer>
                <Button label="取消" text @click="deleteVisible = false" />
                <Button label="删除" severity="danger" @click="doDelete" :loading="deleting" />
            </template>
        </Dialog>
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
import PageHeader from '../components/common/PageHeader.vue'
import EmptyState from '../components/common/EmptyState.vue'

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
    allowedSkills: [],
    allowedTools: []
})

const providerOptions = computed(() => Object.keys(configStore.config?.providers || {}))
const skillOptions = computed(() => skillsStore.skills.map(skill => ({ label: skill.name, value: skill.name })))
const toolOptions = computed(() => toolsStore.tools.map(tool => ({ label: tool.name, value: tool.name })))

function resetForm() {
    form.name = ''
    form.description = ''
    form.provider = providerOptions.value[0] || 'openai'
    form.model = configStore.config?.agent.defaults.model || 'gpt-4o'
    form.systemPrompt = configStore.config?.agent.defaults.systemPrompt || 'You are a helpful AI assistant.'
    form.allowedSkills = []
    form.allowedTools = []
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

function confirmDelete(agent: AgentRole) {
    deletingAgent.value = agent
    deleteVisible.value = true
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

.page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    margin-bottom: 24px;
}

.page-subtitle {
    margin: 4px 0 0;
    color: #64748b;
}

.header-actions {
    display: flex;
    gap: 8px;
}

.agents-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
    gap: 16px;
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
    color: #64748b;
    font-size: 13px;
}

.agent-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 12px;
}

.prompt-preview {
    white-space: pre-wrap;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
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
</style>
