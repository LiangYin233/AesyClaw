<template>
    <div class="plugins-page">
        <div class="page-header">
            <h1>插件管理</h1>
            <Button icon="pi pi-refresh" label="刷新" @click="loadPlugins" :loading="loading" />
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
                        <Tag :value="plugin.enabled ? '已启用' : '已禁用'" :severity="plugin.enabled ? 'success' : 'danger'" />
                    </div>
                </template>
                <template #footer>
                    <div class="plugin-actions">
                        <Button 
                            icon="pi pi-refresh" 
                            label="重载"
                            outlined 
                            size="small"
                            :loading="reloadingPlugin === plugin.name"
                            @click="reloadPluginHandler(plugin)"
                            v-tooltip.top="'重新加载插件代码'"
                        />
                        <ToggleButton 
                            v-model="plugin.enabled" 
                            onLabel="已启用" 
                            offLabel="已禁用"
                            @change="togglePluginEnabled(plugin)"
                            :loading="toggling"
                        />
                        <Button 
                            icon="pi pi-cog" 
                            label="配置" 
                            outlined 
                            size="small"
                            @click="openConfigDialog(plugin)" 
                        />
                    </div>
                </template>
            </Card>
        </div>
        
        <div v-if="!loading && plugins.length === 0" class="empty-state">
            <i class="pi pi-th-large"></i>
            <span>暂无插件</span>
            <p class="empty-hint">请在 plugins 目录下创建插件文件</p>
        </div>

        <Dialog 
            v-model:visible="configDialogVisible" 
            :header="`配置 ${selectedPlugin?.name}`" 
            :modal="true" 
            :style="{ width: '500px' }"
        >
            <div v-if="selectedPlugin" class="config-form">
                <div v-for="(value, key) in configForm" :key="key" class="form-field">
                    <label class="capitalize">{{ formatLabel(key) }}</label>
                    
                    <template v-if="isBoolean(value)">
                        <ToggleButton v-model="configForm[key]" onLabel="是" offLabel="否" />
                    </template>
                    
                    <template v-else-if="isNumber(value)">
                        <InputNumber v-model="configForm[key]" :useGrouping="false" />
                    </template>
                    
                    <template v-else-if="isArray(value)">
                        <InputText v-model="configForm[key]" placeholder="逗号分隔" />
                    </template>
                    
                    <template v-else-if="isObject(value)">
                        <div class="nested-config">
                            <div v-for="(nestedValue, nestedKey) in value" :key="nestedKey" class="nested-field">
                                <label>{{ nestedKey }}</label>
                                <Password 
                                    v-if="isSensitiveKey(nestedKey)" 
                                    v-model="configForm[key][nestedKey]" 
                                    :feedback="false" 
                                    toggleMask 
                                    fluid 
                                />
                                <InputText v-else v-model="configForm[key][nestedKey]" />
                            </div>
                        </div>
                    </template>
                    
                    <template v-else>
                        <Password 
                            v-if="isSensitiveKey(key)" 
                            v-model="configForm[key]" 
                            :feedback="false" 
                            toggleMask 
                            fluid 
                        />
                        <InputText v-else v-model="configForm[key]" />
                    </template>
                </div>
                
                <div v-if="Object.keys(configForm).length === 0" class="no-config">
                    该插件暂无配置选项
                </div>
            </div>
            <template #footer>
                <Button label="取消" severity="secondary" @click="configDialogVisible = false" />
                <Button label="保存" @click="savePluginConfig" :loading="saving" />
            </template>
        </Dialog>
        
        <Toast />
    </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useApi, type PluginInfo } from '../composables/useApi'
import { useToast } from 'primevue/usetoast'
import Button from 'primevue/button'
import Card from 'primevue/card'
import Tag from 'primevue/tag'
import ToggleButton from 'primevue/togglebutton'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import Password from 'primevue/password'
import Toast from 'primevue/toast'

const { getPlugins, togglePlugin, updatePluginConfig, reloadPlugin } = useApi()
const toast = useToast()

const plugins = ref<PluginInfo[]>([])
const loading = ref(false)
const toggling = ref(false)
const saving = ref(false)
const reloadingPlugin = ref<string | null>(null)

const configDialogVisible = ref(false)
const selectedPlugin = ref<PluginInfo | null>(null)
const configForm = reactive<Record<string, any>>({})

async function loadPlugins() {
    loading.value = true
    try {
        plugins.value = await getPlugins()
    } catch (e) {
        console.error('Failed to load plugins:', e)
    } finally {
        loading.value = false
    }
}

async function togglePluginEnabled(plugin: PluginInfo) {
    toggling.value = true
    try {
        const success = await togglePlugin(plugin.name, plugin.enabled)
        if (success) {
            toast.add({ 
                severity: 'success', 
                summary: '成功', 
                detail: plugin.enabled ? '插件已启用' : '插件已禁用', 
                life: 3000 
            })
        } else {
            plugin.enabled = !plugin.enabled
            toast.add({ 
                severity: 'error', 
                summary: '失败', 
                detail: '操作失败', 
                life: 3000 
            })
        }
    } catch (e) {
        plugin.enabled = !plugin.enabled
        console.error('Failed to toggle plugin:', e)
    } finally {
        toggling.value = false
    }
}

async function reloadPluginHandler(plugin: PluginInfo) {
    reloadingPlugin.value = plugin.name
    try {
        const success = await reloadPlugin(plugin.name)
        if (success) {
            toast.add({ 
                severity: 'success', 
                summary: '成功', 
                detail: '插件已重载', 
                life: 3000 
            })
            await loadPlugins()
        } else {
            toast.add({ 
                severity: 'error', 
                summary: '失败', 
                detail: '重载失败', 
                life: 3000 
            })
        }
    } catch (e) {
        console.error('Failed to reload plugin:', e)
        toast.add({ 
            severity: 'error', 
            summary: '错误', 
            detail: '重载失败', 
            life: 3000 
        })
    } finally {
        reloadingPlugin.value = null
    }
}

function openConfigDialog(plugin: PluginInfo) {
    selectedPlugin.value = plugin
    
    Object.keys(configForm).forEach(key => {
        delete configForm[key]
    })
    
    const savedOptions = plugin.options || {}
    const defaultOptions = plugin.defaultConfig?.options || {}
    const configToUse = Object.keys(savedOptions).length > 0 ? savedOptions : defaultOptions
    
    for (const [key, value] of Object.entries(configToUse)) {
        configForm[key] = value
    }
    
    configDialogVisible.value = true
}

async function savePluginConfig() {
    if (!selectedPlugin.value) return
    
    saving.value = true
    try {
        const success = await updatePluginConfig(selectedPlugin.value.name, configForm)
        if (success) {
            toast.add({ 
                severity: 'success', 
                summary: '成功', 
                detail: '配置已保存', 
                life: 3000 
            })
            configDialogVisible.value = false
        } else {
            toast.add({ 
                severity: 'error', 
                summary: '失败', 
                detail: '保存失败', 
                life: 3000 
            })
        }
    } catch (e) {
        console.error('Failed to save config:', e)
    } finally {
        saving.value = false
    }
}

function formatLabel(key: string): string {
    return key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())
}

function isBoolean(value: any): boolean {
    return typeof value === 'boolean'
}

function isNumber(value: any): boolean {
    return typeof value === 'number'
}

function isArray(value: any): boolean {
    return Array.isArray(value)
}

function isObject(value: any): boolean {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSensitiveKey(key: string): boolean {
    const lower = key.toLowerCase()
    return lower.includes('key') || lower.includes('password') || lower.includes('token') || lower.includes('secret') || lower.includes('api')
}

onMounted(() => {
    loadPlugins()
})
</script>

<style scoped>
.plugins-page {
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
    display: flex;
    gap: 8px;
}

.plugin-actions {
    display: flex;
    gap: 8px;
    align-items: center;
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

.config-form {
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

.nested-config {
    padding-left: 16px;
    border-left: 2px solid #e2e8f0;
}

.nested-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 8px;
}

.nested-field label {
    font-size: 13px;
    color: #64748b;
}

.no-config {
    text-align: center;
    color: #94a3b8;
    padding: 24px;
}

.capitalize {
    text-transform: capitalize;
}

@media (prefers-color-scheme: dark) {
    .form-field label {
        color: #94a3b8;
    }
    .nested-field label {
        color: #94a3b8;
    }
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
