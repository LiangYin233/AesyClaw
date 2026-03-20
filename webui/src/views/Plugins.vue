<template>
    <div class="plugins-page page-stack">
        <PageHeader title="插件管理" subtitle="统一管理插件与通道开关和配置项。">
            <template #actions>
                <Button icon="pi pi-refresh" label="刷新" @click="loadPlugins" :loading="loading" />
            </template>
        </PageHeader>

        <LoadingContainer :loading="loading" loading-text="正在加载插件与通道...">
            <EmptyState
                v-if="items.length === 0"
                icon="pi pi-th-large"
                title="暂无插件或通道"
                description="请在 plugins 目录下创建插件文件，或在配置中启用通道。"
            />

            <PageSection v-else title="插件与通道" :subtitle="`${items.length} 项可管理资源`">
                <div class="plugins-grid">
                    <Card v-for="item in items" :key="`${item.kind}:${item.name}`" class="plugin-card">
                        <template #title>
                            <div class="plugin-title">
                                <i :class="item.kind === 'channel' ? 'pi pi-send' : 'pi pi-th-large'"></i>
                                <span>{{ item.name }}</span>
                            </div>
                        </template>
                        <template #subtitle>
                            <span class="version">{{ item.kind === 'channel' ? 'Channel' : `v${item.version}` }}</span>
                        </template>
                        <template #content>
                            <p class="plugin-description">{{ item.description || '暂无描述' }}</p>
                            <div class="plugin-stats">
                                <Tag v-if="item.kind === 'plugin'" :value="`${item.toolsCount} 个工具`" severity="info" />
                                <Tag v-else value="通道适配器" severity="contrast" />
                                <Tag :value="item.enabled ? '已启用' : '已禁用'" :severity="item.enabled ? 'success' : 'danger'" />
                            </div>
                        </template>
                        <template #footer>
                            <div class="plugin-actions">
                                <ToggleButton
                                    v-model="item.enabled"
                                    onLabel="已启用"
                                    offLabel="已禁用"
                                    @change="toggleItemEnabled(item)"
                                    :loading="toggling"
                                />
                                <Button
                                    icon="pi pi-cog"
                                    label="配置"
                                    outlined
                                    size="small"
                                    @click="openConfigDialog(item)"
                                />
                            </div>
                        </template>
                    </Card>
                </div>
            </PageSection>
        </LoadingContainer>
        <Dialog 
            v-model:visible="configDialogVisible" 
            :header="`配置 ${selectedItem?.name}`" 
            :modal="true" 
            :style="{ width: '500px' }"
        >
            <div v-if="selectedItem" class="config-form">
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
                            <div v-for="(_, nestedKey) in value" :key="nestedKey" class="nested-field">
                                <label>{{ nestedKey }}</label>
                                <Password 
                                    v-if="isSensitiveKey(String(nestedKey))" 
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
                    该项暂无可编辑配置
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
import { computed, reactive, ref, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import type { PluginInfo } from '../types/api'
import { useConfigStore, usePluginsStore } from '../stores'
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
import PageHeader from '../components/common/PageHeader.vue'
import LoadingContainer from '../components/common/LoadingContainer.vue'
import EmptyState from '../components/common/EmptyState.vue'
import PageSection from '../components/common/PageSection.vue'
import { formatLabel } from '../utils/formatters'

const pluginsStore = usePluginsStore()
const configStore = useConfigStore()
const { plugins, loading } = storeToRefs(pluginsStore)
const toast = useToast()

const toggling = ref(false)
const saving = ref(false)

const configDialogVisible = ref(false)
type ChannelItem = {
    kind: 'channel'
    name: string
    description: string
    enabled: boolean
    config: Record<string, any>
}

type PluginItem = PluginInfo & { kind: 'plugin' }
type ManageableItem = PluginItem | ChannelItem

const selectedItem = ref<ManageableItem | null>(null)
const configForm = reactive<Record<string, any>>({})

const items = computed<ManageableItem[]>(() => {
    const pluginItems: PluginItem[] = plugins.value.map(plugin => ({ ...plugin, kind: 'plugin' }))
    const channels = configStore.config?.channels || {}
    const channelItems: ChannelItem[] = Object.entries(channels).map(([name, config]) => ({
        kind: 'channel',
        name,
        description: `Channel 适配器：${name}`,
        enabled: Boolean((config as Record<string, any>)?.enabled),
        config: { ...(config as Record<string, any>) }
    }))
    return [...pluginItems, ...channelItems]
})

async function loadPlugins() {
    try {
        await Promise.all([pluginsStore.fetchPlugins(), configStore.fetchConfig()])
    } catch (e) {
        console.error('Failed to load plugins:', e)
    }
}

async function toggleItemEnabled(item: ManageableItem) {
    toggling.value = true
    try {
        if (item.kind === 'channel') {
            if (!configStore.config?.channels?.[item.name]) {
                toast.add({ severity: 'error', summary: '失败', detail: '通道配置不存在', life: 3000 })
                return
            }
            configStore.config.channels[item.name].enabled = item.enabled
            const success = await configStore.saveConfig()
            if (success) {
                toast.add({ severity: 'success', summary: '成功', detail: item.enabled ? '通道已启用' : '通道已禁用', life: 3000 })
            } else {
                item.enabled = !item.enabled
                toast.add({ severity: 'error', summary: '失败', detail: '操作失败', life: 3000 })
            }
            return
        }

        const success = await pluginsStore.togglePlugin(item.name, item.enabled)
        if (success) {
            toast.add({ severity: 'success', summary: '成功', detail: item.enabled ? '插件已启用' : '插件已禁用', life: 3000 })
        } else {
            item.enabled = !item.enabled
            toast.add({ severity: 'error', summary: '失败', detail: '操作失败', life: 3000 })
        }
    } catch (e) {
        item.enabled = !item.enabled
        console.error('Failed to toggle item:', e)
    } finally {
        toggling.value = false
    }
}

function openConfigDialog(item: ManageableItem) {
    selectedItem.value = item
    Object.keys(configForm).forEach(key => { delete configForm[key] })
    const configToUse = item.kind === 'channel'
        ? item.config
        : (Object.keys(item.options || {}).length > 0 ? item.options || {} : item.defaultConfig?.options || {})
    for (const [key, value] of Object.entries(configToUse)) {
        configForm[key] = value
    }
    configDialogVisible.value = true
}

async function savePluginConfig() {
    if (!selectedItem.value) return
    saving.value = true
    try {
        if (selectedItem.value.kind === 'channel') {
            if (!configStore.config) {
                toast.add({ severity: 'error', summary: '失败', detail: '配置未加载', life: 3000 })
                return
            }
            configStore.config.channels[selectedItem.value.name] = { ...configForm }
            const success = await configStore.saveConfig()
            if (success) {
                toast.add({ severity: 'success', summary: '成功', detail: '通道配置已保存', life: 3000 })
                configDialogVisible.value = false
                await loadPlugins()
            } else {
                toast.add({ severity: 'error', summary: '失败', detail: '保存失败', life: 3000 })
            }
            return
        }

        const success = await pluginsStore.updatePluginConfig(selectedItem.value.name, configForm)
        if (success) {
            toast.add({ severity: 'success', summary: '成功', detail: '配置已保存', life: 3000 })
            configDialogVisible.value = false
        } else {
            toast.add({ severity: 'error', summary: '失败', detail: '保存失败', life: 3000 })
        }
    } catch (e) {
        console.error('Failed to save config:', e)
    } finally {
        saving.value = false
    }
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
    color: var(--ui-primary);
}

.version {
    font-size: 12px;
    color: var(--ui-text-faint);
}

.plugin-description {
    margin: 8px 0;
    color: var(--ui-text-muted);
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
    color: var(--ui-text-soft);
}

.nested-config {
    padding-left: 16px;
    border-left: 2px solid var(--ui-border);
}

.nested-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 8px;
}

.nested-field label {
    font-size: 13px;
    color: var(--ui-text-muted);
}

.no-config {
    text-align: center;
    color: var(--ui-text-faint);
    padding: 24px;
}

.capitalize {
    text-transform: capitalize;
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
