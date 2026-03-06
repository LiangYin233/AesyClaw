<template>
    <div class="skills-page">
        <div class="page-header">
            <div class="page-title-group">
                <h1>Skills 管理</h1>
                <span class="page-subtitle">配置 Agent 可用的 Skills</span>
            </div>
            <Button label="刷新" icon="pi pi-refresh" outlined @click="loadSkills" :loading="loading" />
        </div>

        <div v-if="skills.length > 0" class="skills-list">
            <Card v-for="skill in skills" :key="skill.name" class="skill-card" @click="viewSkillDetails(skill.name)">
                <template #title>
                    <div class="skill-header">
                        <span class="skill-name">{{ skill.name }}</span>
                        <div class="skill-toggle" @click.stop>
                            <span class="skill-status" :class="skill.enabled ? 'enabled' : 'disabled'">
                                {{ skill.enabled ? '已启用' : '已禁用' }}
                            </span>
                            <InputSwitch v-model="skill.enabled" @change="toggleSkillHandler(skill.name, skill.enabled)" />
                        </div>
                    </div>
                </template>
                <template #content>
                    <p class="skill-description">{{ skill.description || '暂无描述' }}</p>
                    <div class="skill-files" v-if="skill.files?.length">
                        <small>文件: {{ skill.files.map(f => f.name).join(', ') }}</small>
                    </div>
                    <div class="skill-action">
                        <small class="view-details-hint">点击查看详情</small>
                    </div>
                </template>
            </Card>
        </div>

        <Message v-else-if="!loading" severity="info" :closable="false">
            暂无已加载的 Skills
        </Message>

        <div v-else-if="loading" class="loading-container">
            <ProgressSpinner />
        </div>

        <!-- Skill Details Dialog -->
        <Dialog v-model:visible="showDetailsDialog" :header="`Skill: ${selectedSkill?.name || ''}`" :style="{ width: '800px' }" modal>
            <div v-if="selectedSkill" class="skill-details">
                <div class="details-header">
                    <div class="detail-item">
                        <span class="detail-label">状态:</span>
                        <Tag :value="selectedSkill.enabled ? '已启用' : '已禁用'" :severity="selectedSkill.enabled ? 'success' : 'secondary'" />
                    </div>
                    <div class="detail-item" v-if="selectedSkill.files?.length">
                        <span class="detail-label">文件数:</span>
                        <span>{{ selectedSkill.files.length }}</span>
                    </div>
                </div>
                <div class="details-content" v-if="selectedSkill.content">
                    <pre class="markdown-content">{{ selectedSkill.content }}</pre>
                </div>
                <Message v-else severity="warn" :closable="false">
                    该 Skill 没有内容
                </Message>
            </div>
            <template #footer>
                <Button label="关闭" @click="showDetailsDialog = false" />
            </template>
        </Dialog>

        <Toast />
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useApi, type SkillInfo } from '../composables/useApi'
import { useToast } from 'primevue/usetoast'
import Card from 'primevue/card'
import Message from 'primevue/message'
import ProgressSpinner from 'primevue/progressspinner'
import Button from 'primevue/button'
import InputSwitch from 'primevue/inputswitch'
import Dialog from 'primevue/dialog'
import Tag from 'primevue/tag'
import Toast from 'primevue/toast'

const { getSkills, getSkill, toggleSkill } = useApi()
const toast = useToast()
const skills = ref<SkillInfo[]>([])
const loading = ref(false)
const showDetailsDialog = ref(false)
const selectedSkill = ref<SkillInfo | null>(null)

async function loadSkills() {
    loading.value = true
    skills.value = await getSkills()
    loading.value = false
}

async function viewSkillDetails(name: string) {
    const skill = await getSkill(name)
    if (skill) {
        selectedSkill.value = skill
        showDetailsDialog.value = true
    } else {
        toast.add({
            severity: 'error',
            summary: '错误',
            detail: '获取 Skill 详情失败',
            life: 3000
        })
    }
}

async function toggleSkillHandler(name: string, enabled: boolean) {
    const success = await toggleSkill(name, enabled)
    if (success) {
        toast.add({
            severity: 'success',
            summary: '成功',
            detail: `Skill ${name} 已${enabled ? '启用' : '禁用'}`,
            life: 3000
        })
    } else {
        toast.add({
            severity: 'error',
            summary: '错误',
            detail: `切换 Skill 状态失败`,
            life: 3000
        })
        // 恢复原状态
        const skill = skills.value.find(s => s.name === name)
        if (skill) skill.enabled = !enabled
    }
}

onMounted(() => {
    loadSkills()
})
</script>

<style scoped>
.skills-page {
    padding: 0;
}

.page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24px;
}

.page-title-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.page-title-group h1 {
    margin: 0;
    font-size: 24px;
    font-weight: bold;
}

.page-subtitle {
    font-size: 13px;
    color: #94a3b8;
}

.skills-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 16px;
}

.skill-card {
    margin-bottom: 0;
    cursor: pointer;
    transition: transform 0.2s, box-shadow 0.2s;
}

.skill-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.skill-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
}

.skill-name {
    font-size: 16px;
    font-weight: 600;
}

.skill-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
}

.skill-status {
    font-size: 12px;
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid transparent;
}

.skill-status.enabled {
    background: #dcfce7;
    color: #15803d;
    border-color: #bbf7d0;
}

.skill-status.disabled {
    background: #f1f5f9;
    color: #64748b;
    border-color: #e2e8f0;
}

.skill-description {
    margin: 0 0 8px 0;
    color: #475569;
    line-height: 1.5;
}

.skill-files {
    color: #94a3b8;
    margin-bottom: 8px;
}

.skill-action {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid #e2e8f0;
}

.view-details-hint {
    color: #3b82f6;
    font-size: 12px;
}

.loading-container {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 48px;
}

.skill-details {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.details-header {
    display: flex;
    gap: 24px;
    padding: 12px;
    background: #f8fafc;
    border-radius: 8px;
}

.detail-item {
    display: flex;
    align-items: center;
    gap: 8px;
}

.detail-label {
    font-size: 13px;
    font-weight: 600;
    color: #64748b;
}

.details-content {
    max-height: 500px;
    overflow-y: auto;
}

.markdown-content {
    margin: 0;
    padding: 16px;
    background: #f8fafc;
    border-radius: 8px;
    font-family: 'Consolas', 'Monaco', monospace;
    font-size: 13px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-wrap: break-word;
    color: #1e293b;
}

@media (prefers-color-scheme: dark) {
    .page-subtitle {
        color: #64748b;
    }

    .skill-card:hover {
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }

    .skill-description {
        color: #cbd5e1;
    }

    .skill-files {
        color: #64748b;
    }

    .skill-action {
        border-top-color: #334155;
    }

    .view-details-hint {
        color: #60a5fa;
    }

    .details-header {
        background: #1e293b;
    }

    .detail-label {
        color: #94a3b8;
    }

    .markdown-content {
        background: #1e293b;
        color: #e2e8f0;
    }
}
</style>
