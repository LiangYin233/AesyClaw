<template>
    <div class="tools-page">
        <div class="page-header">
            <h1>工具列表</h1>
            <Button icon="pi pi-refresh" label="刷新" @click="loadTools" />
        </div>
        
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
                        <span class="params-label">参数:</span>
                        <div class="params-list">
                            <Tag v-for="(_, key) in tool.parameters?.properties" :key="String(key)" 
                                :value="String(key)" 
                                severity="secondary" />
                        </div>
                    </div>
                </template>
            </Card>
        </div>
        
        <div v-if="!loading && tools.length === 0" class="empty-state">
            <i class="pi pi-box"></i>
            <span>暂无工具</span>
        </div>
    </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useToolsStore } from '../stores'
import Button from 'primevue/button'
import Card from 'primevue/card'
import Tag from 'primevue/tag'

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
.tools-page {
    padding: 0;
}

.page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24px;
    flex-wrap: wrap;
    gap: 12px;
}

.page-header h1 {
    margin: 0;
    font-size: 24px;
    font-weight: bold;
}

.tools-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 16px;
}

.tool-card {
    transition: box-shadow 0.2s;
    min-width: 0;
    overflow: hidden;
}

.tool-card:hover {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.tool-title {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
}

.tool-title i {
    font-size: 18px;
    flex-shrink: 0;
}

.tool-title span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
}

.tool-description {
    margin: 8px 0 0 0;
    color: #64748b;
    font-size: 14px;
    word-wrap: break-word;
    overflow-wrap: break-word;
    line-height: 1.5;
}

.tool-params {
    margin-top: 12px;
}

.params-label {
    font-size: 12px;
    color: #94a3b8;
    display: block;
    margin-bottom: 8px;
}

.params-list {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
}

.empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 48px;
    color: #94a3b8;
    gap: 8px;
}

.empty-state i {
    font-size: 48px;
}

@media (max-width: 768px) {
    .tools-grid {
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    }

    .page-header h1 {
        font-size: 20px;
    }
}

@media (max-width: 640px) {
    .tools-grid {
        grid-template-columns: 1fr;
    }

    .page-header {
        flex-direction: column;
        align-items: stretch;
    }
}
</style>
