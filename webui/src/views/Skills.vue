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
            <Card v-for="skill in skills" :key="skill.name" class="skill-card">
                <template #title>
                    <div class="skill-header">
                        <span class="skill-name">{{ skill.name }}</span>
                        <div class="skill-toggle">
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
                </template>
            </Card>
        </div>

        <Message v-else-if="!loading" severity="info" :closable="false">
            暂无已加载的 Skills
        </Message>

        <div v-else-if="loading" class="loading-container">
            <ProgressSpinner />
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useApi, type SkillInfo } from '../composables/useApi'
import Card from 'primevue/card'
import Message from 'primevue/message'
import ProgressSpinner from 'primevue/progressspinner'
import Button from 'primevue/button'
import InputSwitch from 'primevue/inputswitch'

const { getSkills, toggleSkill } = useApi()
const skills = ref<SkillInfo[]>([])
const loading = ref(false)

async function loadSkills() {
    loading.value = true
    skills.value = await getSkills()
    loading.value = false
}

async function toggleSkillHandler(name: string, enabled: boolean) {
    await toggleSkill(name, enabled)
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
}

.loading-container {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 48px;
}
</style>
