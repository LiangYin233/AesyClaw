<template>
    <div class="skills-page page-stack">
        <PageHeader title="技能管理" subtitle="查看内置与外置技能，并管理可配置的外置技能。">
            <template #actions>
                <Button label="刷新" icon="pi pi-refresh" outlined @click="reloadAllSkills" :loading="loading || reloading" />
            </template>
        </PageHeader>

        <LoadingContainer :loading="loading" loading-text="正在加载 Skills...">
            <EmptyState
                v-if="skills.length === 0"
                icon="pi pi-star"
                title="暂无已加载的 Skills"
                description="当前没有可用 Skill，启用或安装后会显示在这里。"
            />

            <PageSection v-else title="Skill 列表" :subtitle="`${skills.length} 个 Skill`">
                <div class="skills-list">
                    <Card v-for="skill in skills" :key="skill.name" class="skill-card" @click="viewSkillDetails(skill.name)">
                        <template #title>
                            <div class="skill-header">
                                <span class="skill-name">{{ skill.name }}</span>
                                <div class="skill-toggle" @click.stop>
                                    <Tag
                                        :value="skill.builtin ? '内置' : '外置'"
                                        :severity="skill.builtin ? 'info' : 'warning'"
                                    />
                                    <Tag
                                        :value="skill.enabled ? '已启用' : '已禁用'"
                                        :severity="skill.enabled ? 'success' : 'secondary'"
                                    />
                                    <InputSwitch
                                        v-if="skill.configurable"
                                        v-model="skill.enabled"
                                        @change="toggleSkillHandler(skill.name, skill.enabled)"
                                    />
                                    <Tag
                                        v-else
                                        value="固定启用"
                                        severity="contrast"
                                    />
                                </div>
                            </div>
                        </template>
                        <template #content>
                            <p class="skill-description">{{ skill.description || '暂无描述' }}</p>
                            <div class="skill-files" v-if="skill.files?.length">
                                <small>文件：{{ skill.files.map(f => f.name).join('、') }}</small>
                            </div>
                            <div class="skill-action">
                                <small class="view-details-hint">点击查看详情</small>
                            </div>
                        </template>
                    </Card>
                </div>
            </PageSection>
        </LoadingContainer>

        <Dialog v-model:visible="showDetailsDialog" :header="`Skill: ${selectedSkill?.name || ''}`" :style="{ width: '800px' }" modal>
            <div v-if="selectedSkill" class="skill-details">
                <div class="details-header surface-panel">
                    <div class="detail-item">
                        <span class="detail-label">状态</span>
                        <Tag :value="selectedSkill.enabled ? '已启用' : '已禁用'" :severity="selectedSkill.enabled ? 'success' : 'secondary'" />
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">来源</span>
                        <Tag :value="selectedSkill.builtin ? '内置' : '外置'" :severity="selectedSkill.builtin ? 'info' : 'warning'" />
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">配置</span>
                        <Tag :value="selectedSkill.configurable ? '可禁用' : '固定启用'" :severity="selectedSkill.configurable ? 'secondary' : 'contrast'" />
                    </div>
                    <div class="detail-item" v-if="selectedSkill.files?.length">
                        <span class="detail-label">文件数</span>
                        <span>{{ selectedSkill.files.length }}</span>
                    </div>
                </div>
                <div class="details-content" v-if="selectedSkill.content">
                    <pre class="markdown-content">{{ selectedSkill.content }}</pre>
                </div>
                <EmptyState
                    v-else
                    icon="pi pi-file"
                    title="该 Skill 没有内容"
                    description="当前 Skill 未提供可展示的正文内容。"
                />
            </div>
            <template #footer>
                <Button label="关闭" @click="showDetailsDialog = false" />
            </template>
        </Dialog>

        <Toast />
    </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useSkillsStore } from '../stores'
import { useToast } from 'primevue/usetoast'
import Card from 'primevue/card'
import Button from 'primevue/button'
import InputSwitch from 'primevue/inputswitch'
import Dialog from 'primevue/dialog'
import Tag from 'primevue/tag'
import Toast from 'primevue/toast'
import PageHeader from '../components/common/PageHeader.vue'
import LoadingContainer from '../components/common/LoadingContainer.vue'
import EmptyState from '../components/common/EmptyState.vue'
import PageSection from '../components/common/PageSection.vue'

const skillsStore = useSkillsStore()
const { skills, selectedSkill, loading, reloading } = storeToRefs(skillsStore)
const toast = useToast()
const showDetailsDialog = ref(false)

async function viewSkillDetails(name: string) {
    const skill = await skillsStore.fetchSkill(name)
    if (skill) {
        showDetailsDialog.value = true
    } else {
        toast.add({ severity: 'error', summary: '错误', detail: '获取 Skill 详情失败', life: 3000 })
    }
}

async function toggleSkillHandler(name: string, enabled: boolean) {
    const success = await skillsStore.toggleSkill(name, enabled)
    if (success) {
        toast.add({ severity: 'success', summary: '成功', detail: `Skill ${name} 已${enabled ? '启用' : '禁用'}`, life: 3000 })
    } else {
        toast.add({ severity: 'error', summary: '错误', detail: '切换 Skill 状态失败', life: 3000 })
        const skill = skills.value.find(s => s.name === name)
        if (skill) skill.enabled = !enabled
    }
}

async function reloadAllSkills() {
    const summary = await skillsStore.reloadSkills()
    if (!summary) {
        toast.add({ severity: 'error', summary: '错误', detail: skillsStore.error || '重新加载 Skills 失败', life: 3000 })
        return
    }

    if (showDetailsDialog.value && selectedSkill.value === null) {
        showDetailsDialog.value = false
    }

    const parts = [
        `新增 ${summary.added.length}`,
        `更新 ${summary.updated.length}`,
        `移除 ${summary.removed.length}`,
        `清理引用 ${summary.cleanedAgentRefs}`
    ]

    toast.add({
        severity: 'success',
        summary: 'Skills 已重新加载',
        detail: parts.join('，'),
        life: 3500
    })
}

onMounted(() => {
    skillsStore.fetchSkills()
})
</script>

<style scoped>
.skills-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: var(--ui-space-4);
}

.skill-card {
    margin-bottom: 0;
    cursor: pointer;
    transition: transform 0.18s ease, box-shadow 0.18s ease;
}

.skill-card:hover {
    transform: translateY(-2px);
    box-shadow: var(--ui-shadow-md);
}

.skill-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--ui-space-3);
    width: 100%;
}

.skill-name {
    min-width: 0;
    font-size: 1rem;
    font-weight: 700;
    overflow-wrap: anywhere;
}

.skill-toggle {
    display: flex;
    align-items: center;
    gap: var(--ui-space-2);
    flex-shrink: 0;
}

.skill-description {
    margin: 0 0 var(--ui-space-3) 0;
    color: var(--ui-text-soft);
    line-height: 1.6;
    overflow-wrap: anywhere;
}

.skill-files {
    color: var(--ui-text-faint);
    margin-bottom: var(--ui-space-3);
}

.skill-action {
    margin-top: var(--ui-space-3);
    padding-top: var(--ui-space-3);
    border-top: 1px solid var(--ui-border);
}

.view-details-hint {
    color: var(--ui-primary);
    font-size: 0.78rem;
    font-weight: 600;
}

.skill-details {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-4);
}

.details-header {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ui-space-5);
    padding: var(--ui-space-4);
    border-radius: var(--ui-radius-md);
}

.detail-item {
    display: flex;
    align-items: center;
    gap: var(--ui-space-2);
}

.detail-label {
    font-size: 0.84rem;
    font-weight: 700;
    color: var(--ui-text-muted);
}

.details-content {
    max-height: 500px;
    overflow: auto;
    padding: var(--ui-space-4);
    border-radius: var(--ui-radius-md);
    border: 1px solid var(--ui-border);
    background: var(--ui-surface-muted);
}

.markdown-content {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.7;
    color: var(--ui-text-soft);
}

@media (max-width: 768px) {
    .skills-list {
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    }
}

@media (max-width: 640px) {
    .skills-list {
        grid-template-columns: 1fr;
    }

    .skill-header {
        flex-direction: column;
        align-items: stretch;
    }

    .skill-toggle {
        justify-content: space-between;
    }
}
</style>
