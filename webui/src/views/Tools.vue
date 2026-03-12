<template>
    <div class="tools-page page-stack">
        <PageHeader title="工具列表" subtitle="查看系统已注册工具及其参数结构">
            <template #actions>
                <Button icon="pi pi-refresh" label="刷新" @click="loadTools" :loading="loading" />
            </template>
        </PageHeader>

        <LoadingContainer :loading="loading" loading-text="正在加载工具列表...">
            <EmptyState
                v-if="tools.length === 0"
                icon="pi pi-box"
                title="暂无工具"
                description="当前没有可展示的工具，稍后刷新或检查插件与运行时注册状态。"
            />

            <PageSection v-else title="可用工具" :subtitle="`${tools.length} 个已注册工具`">
                <div class="tools-grid">
                    <Card v-for="tool in tools" :key="tool.name" class="tool-card">
                        <template #title>
                            <div class="tool-title">
                                <i class="pi pi-box"></i>
                                <span>{{ tool.name }}</span>
                            </div>
                        </template>
                        <template #content>
                            <p class="tool-description">{{ tool.description }}</p>
                            <div v-if="tool.parameters?.properties" class="tool-params">
                                <span class="params-label">参数</span>
                                <div class="params-list">
                                    <Tag
                                        v-for="(_, key) in tool.parameters?.properties"
                                        :key="String(key)"
                                        :value="String(key)"
                                        severity="secondary"
                                    />
                                </div>
                            </div>
                        </template>
                    </Card>
                </div>
            </PageSection>
        </LoadingContainer>
    </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useToolsStore } from '../stores'
import Button from 'primevue/button'
import Card from 'primevue/card'
import Tag from 'primevue/tag'
import PageHeader from '../components/common/PageHeader.vue'
import LoadingContainer from '../components/common/LoadingContainer.vue'
import EmptyState from '../components/common/EmptyState.vue'
import PageSection from '../components/common/PageSection.vue'

const toolsStore = useToolsStore()
const { tools, loading } = storeToRefs(toolsStore)

async function loadTools() {
    await toolsStore.fetchTools()
}

onMounted(() => {
    loadTools()
})
</script>

<style scoped>
.tools-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: var(--ui-space-4);
}

.tool-card {
    min-width: 0;
    overflow: hidden;
    transition: transform 0.18s ease, box-shadow 0.18s ease;
}

.tool-card:hover {
    transform: translateY(-2px);
    box-shadow: var(--ui-shadow-md);
}

.tool-title {
    display: flex;
    align-items: center;
    gap: var(--ui-space-2);
    min-width: 0;
}

.tool-title i {
    font-size: 18px;
    color: var(--ui-primary);
    flex-shrink: 0;
}

.tool-title span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
}

.tool-description {
    margin: 0;
    color: var(--ui-text-muted);
    font-size: 0.92rem;
    line-height: 1.6;
    overflow-wrap: anywhere;
}

.tool-params {
    margin-top: var(--ui-space-4);
}

.params-label {
    display: block;
    margin-bottom: var(--ui-space-2);
    font-size: 0.78rem;
    font-weight: 700;
    color: var(--ui-text-faint);
    text-transform: uppercase;
    letter-spacing: 0.08em;
}

.params-list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ui-space-2);
}

@media (max-width: 768px) {
    .tools-grid {
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    }
}

@media (max-width: 640px) {
    .tools-grid {
        grid-template-columns: 1fr;
    }
}
</style>
