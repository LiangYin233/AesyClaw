<template>
    <div class="plugins-page">
        <div class="page-header">
            <h1>插件管理</h1>
            <Button icon="pi pi-refresh" label="刷新" @click="loadPlugins" />
        </div>
        
        <div class="plugins-grid">
            <Card v-for="plugin in plugins" :key="plugin.name" class="plugin-card">
                <template #title>
                    <div class="plugin-title">
                        <i class="pi pi-th-large"></i>
                        <span>{{ plugin.name }}</span>
                    </div>
                </template>
                <template #subtitle>
                    <span class="version">v{{ plugin.version }}</span>
                </template>
                <template #content>
                    <p class="plugin-description">{{ plugin.description || '暂无描述' }}</p>
                    <div class="plugin-stats">
                        <Tag :value="`${plugin.toolsCount} 个工具`" severity="info" />
                    </div>
                </template>
            </Card>
        </div>
        
        <div v-if="!loading && plugins.length === 0" class="empty-state">
            <i class="pi pi-th-large"></i>
            <span>暂无插件</span>
            <p class="empty-hint">请在 plugins 目录下创建插件文件</p>
        </div>
        
        <Divider />
        
        <div class="plugin-help">
            <h3>插件开发</h3>
            <p>查看 <a href="/PLUGIN_DEV.md" target="_blank">插件开发文档</a> 了解如何创建插件</p>
            
            <div class="config-example">
                <h4>配置示例 (config.yaml)</h4>
                <pre><code>plugins:
  filesystem:
    enabled: true
  shell:
    enabled: true
    options:
      allowedCommands:
        - git
        - npm</code></pre>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import Button from 'primevue/button'
import Card from 'primevue/card'
import Tag from 'primevue/tag'
import Divider from 'primevue/divider'

interface Plugin {
    name: string
    version: string
    description?: string
    toolsCount: number
}

const plugins = ref<Plugin[]>([])
const loading = ref(false)

async function loadPlugins() {
    loading.value = true
    try {
        const res = await fetch('/api/plugins')
        const data = await res.json()
        plugins.value = data.plugins || []
    } catch (e) {
        console.error('Failed to load plugins:', e)
    } finally {
        loading.value = false
    }
}

onMounted(() => {
    loadPlugins()
})
</script>

<style scoped>
.plugins-page {
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

.plugins-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
}

.plugin-card {
    transition: box-shadow 0.2s;
}

.plugin-card:hover {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.plugin-title {
    display: flex;
    align-items: center;
    gap: 8px;
}

.plugin-title i {
    font-size: 18px;
    color: #6366f1;
}

.version {
    font-size: 12px;
    color: #94a3b8;
}

.plugin-description {
    margin: 8px 0;
    color: #64748b;
    font-size: 14px;
}

.plugin-stats {
    margin-top: 12px;
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

.empty-hint {
    font-size: 14px;
    color: #64748b;
    margin-top: 8px;
}

.plugin-help {
    margin-top: 24px;
}

.plugin-help h3 {
    margin: 0 0 12px 0;
    font-size: 18px;
}

.plugin-help a {
    color: #6366f1;
    text-decoration: none;
}

.plugin-help a:hover {
    text-decoration: underline;
}

.config-example {
    margin-top: 16px;
    padding: 16px;
    background: #1e293b;
    border-radius: 8px;
    overflow-x: auto;
}

.config-example h4 {
    margin: 0 0 12px 0;
    color: #e2e8f0;
    font-size: 14px;
}

.config-example pre {
    margin: 0;
}

.config-example code {
    color: #a5b4fc;
    font-size: 13px;
    font-family: 'Monaco', 'Menlo', monospace;
}

@media (max-width: 1024px) {
    .plugins-grid {
        grid-template-columns: repeat(2, 1fr);
    }
}

@media (max-width: 640px) {
    .plugins-grid {
        grid-template-columns: 1fr;
    }
}
</style>
