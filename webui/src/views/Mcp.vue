<template>
    <div class="mcp-page page-stack">
        <PageHeader title="MCP 服务器管理" subtitle="集中查看连接状态、工具数量与服务器配置。">
            <template #actions>
                <Button label="刷新" icon="pi pi-refresh" outlined @click="loadServers" :loading="loading" />
                <Button label="添加服务器" icon="pi pi-plus" @click="showAddDialog = true" />
            </template>
        </PageHeader>

        <LoadingContainer :loading="loading" loading-text="正在加载 MCP 服务器...">
            <EmptyState
                v-if="servers.length === 0"
                icon="pi pi-server"
                title="暂无 MCP 服务器"
                description="点击右上角“添加服务器”即可创建本地或 HTTP MCP 服务。"
            >
                <template #actions>
                    <Button label="添加服务器" icon="pi pi-plus" @click="showAddDialog = true" />
                </template>
            </EmptyState>

            <PageSection v-else title="服务器列表" :subtitle="`${servers.length} 个已配置服务器`">
                <div class="mcp-sections">
                    <div
                        v-for="server in servers"
                        :key="server.name"
                        class="mcp-card"
                    >
                        <div class="mcp-header">
                            <div class="mcp-name-group">
                                <span class="mcp-name">{{ server.name }}</span>
                                <span class="mcp-type-tag">
                                    {{ server.config.type === 'local' ? '本地 (Stdio)' : 'HTTP (SSE)' }}
                                </span>
                            </div>
                            <div class="mcp-header-actions">
                                <Tag
                                    :value="getStatusLabel(server.status)"
                                    :severity="getStatusSeverity(server.status)"
                                />
                                <Button
                                    icon="pi pi-eye"
                                    text
                                    rounded
                                    size="small"
                                    @click="viewServerDetails(server)"
                                    v-tooltip.top="'查看工具列表'"
                                />
                                <Button
                                    icon="pi pi-refresh"
                                    text
                                    rounded
                                    size="small"
                                    @click="reconnectServer(server.name)"
                                    :disabled="server.status === 'connecting'"
                                    v-tooltip.top="'重新连接'"
                                />
                                <InputSwitch
                                    :modelValue="server.config.enabled !== false"
                                    @update:modelValue="toggleServer(server.name, $event)"
                                />
                                <Button
                                    icon="pi pi-trash"
                                    severity="danger"
                                    text
                                    rounded
                                    size="small"
                                    @click="serverToDelete = server; showDeleteDialog = true"
                                    v-tooltip.top="'删除服务器'"
                                />
                            </div>
                        </div>

                        <div class="mcp-info">
                            <div v-for="item in getServerInfo(server)" :key="item.label" class="info-item">
                                <span class="info-label">{{ item.label }}:</span>
                                <span class="info-value" :class="{ 'error-text': item.error }">{{ item.value }}</span>
                            </div>
                        </div>

                        <div class="mcp-config">
                            <div v-for="item in getServerConfig(server)" :key="item.label" class="config-item">
                                <span class="config-label">{{ item.label }}:</span>
                                <code class="config-value">{{ item.value }}</code>
                            </div>
                        </div>
                    </div>
                </div>
            </PageSection>
        </LoadingContainer>
        <!-- Add Server Dialog -->
        <Dialog v-model:visible="showAddDialog" header="添加 MCP 服务器" :style="{ width: '600px' }" modal>
            <div class="form-stack">
                <div class="form-field">
                    <label>服务器名称 *</label>
                    <InputText v-model="newServer.name" placeholder="例如: filesystem" />
                </div>
                <div class="form-field">
                    <label>类型 *</label>
                    <Select
                        v-model="newServer.type"
                        :options="mcpTypes"
                        optionLabel="label"
                        optionValue="value"
                        placeholder="选择类型"
                        fluid
                    />
                </div>
                <div class="form-field" v-if="newServer.type === 'local'">
                    <label>命令 (JSON 数组) *</label>
                    <Textarea
                        v-model="newServer.command"
                        placeholder='["npx", "-y", "@modelcontextprotocol/server-filesystem", "/path/to/files"]'
                        rows="3"
                        fluid
                    />
                    <small class="field-hint">以 JSON 数组形式填写完整命令及参数</small>
                </div>
                <div class="form-field" v-if="newServer.type === 'http'">
                    <label>URL *</label>
                    <InputText v-model="newServer.url" placeholder="http://localhost:3000/sse" />
                    <small class="field-hint">指向 MCP HTTP(SSE) 服务器地址</small>
                </div>
                <div class="form-field">
                    <label>环境变量 (JSON 对象)</label>
                    <Textarea
                        v-model="newServer.environment"
                        placeholder='{"KEY": "value"}'
                        rows="2"
                        fluid
                    />
                </div>
                <div class="form-field">
                    <label>超时 (毫秒)</label>
                    <InputNumber v-model="newServer.timeout" placeholder="120000" :useGrouping="false" />
                </div>
            </div>
            <template #footer>
                <Button label="取消" text @click="showAddDialog = false" />
                <Button label="添加并连接" @click="addServer" :loading="adding" />
            </template>
        </Dialog>

        <!-- Server Details Dialog -->
        <Dialog v-model:visible="showDetailsDialog" header="服务器详情" :style="{ width: '700px' }" modal>
            <div v-if="selectedServer">
                <div class="details-section">
                    <h3>基本信息</h3>
                    <div class="details-grid">
                        <div v-for="item in getServerDetails(selectedServer)" :key="item.label" class="detail-item">
                            <span class="detail-label">{{ item.label }}:</span>
                            <Tag
                                v-if="item.status"
                                :value="item.value"
                                :severity="getStatusSeverity(selectedServer.status)"
                            />
                            <span v-else class="detail-value">{{ item.value }}</span>
                        </div>
                    </div>
                </div>

                <div class="details-section">
                    <h3>工具列表</h3>
                    <div v-if="serverTools.length > 0" class="tools-list">
                        <div v-for="tool in serverTools" :key="tool.name" class="tool-item">
                            <span class="tool-name">{{ tool.name }}</span>
                            <p class="tool-description">{{ tool.description }}</p>
                        </div>
                    </div>
                    <Message v-else severity="info" :closable="false">
                        该服务器暂无可用工具
                    </Message>
                </div>
            </div>
            <template #footer>
                <Button label="关闭" @click="showDetailsDialog = false" />
            </template>
        </Dialog>

        <ConfirmDialog
            v-model:visible="showDeleteDialog"
            title="确认删除"
            :message="`确定要删除服务器 ${serverToDelete?.name || ''} 吗？此操作无法撤销。`"
            :loading="deleting"
            confirm-label="删除"
            confirm-severity="danger"
            :on-confirm="deleteServer"
        />

        <Toast />
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import type { MCPServerInfo, MCPServerConfig } from '../types/api'
import { useMcpStore } from '../stores'
import { useToast } from 'primevue/usetoast'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import Select from 'primevue/select'
import InputSwitch from 'primevue/inputswitch'
import Textarea from 'primevue/textarea'
import Message from 'primevue/message'
import Toast from 'primevue/toast'
import Dialog from 'primevue/dialog'
import Tag from 'primevue/tag'
import PageHeader from '../components/common/PageHeader.vue'
import LoadingContainer from '../components/common/LoadingContainer.vue'
import EmptyState from '../components/common/EmptyState.vue'
import PageSection from '../components/common/PageSection.vue'
import ConfirmDialog from '../components/common/ConfirmDialog.vue'
import { formatDateTime } from '../utils/formatters'

const mcpStore = useMcpStore()
const { servers, loading, selectedServer, serverTools } = storeToRefs(mcpStore)
const toast = useToast()

const adding = ref(false)
const deleting = ref(false)
const showAddDialog = ref(false)
const showDetailsDialog = ref(false)
const showDeleteDialog = ref(false)
const serverToDelete = ref<MCPServerInfo | null>(null)

const mcpTypes = [
    { label: '本地 (Stdio)', value: 'local' },
    { label: 'HTTP (SSE)', value: 'http' }
]

const DEFAULT_SERVER = {
    name: '',
    type: 'local' as 'local' | 'http',
    command: '["npx", "-y", "@modelcontextprotocol/server-filesystem", "/path/to/files"]',
    url: '',
    environment: '{}',
    timeout: 120000
}
const STATUS_META: Record<string, { label: string; severity: 'success' | 'info' | 'warn' | 'danger' }> = {
    connecting: { label: '连接中', severity: 'info' },
    connected: { label: '已连接', severity: 'success' },
    failed: { label: '失败', severity: 'danger' },
    disconnected: { label: '已断开', severity: 'warn' }
}

const newServer = ref({ ...DEFAULT_SERVER })
const notify = (severity: 'success' | 'info' | 'warn' | 'error', detail: string, summary = severity === 'error' ? '错误' : severity === 'warn' ? '警告' : '成功') =>
    toast.add({ severity, summary, detail, life: 3000 })

let refreshInterval: number | null = null

async function loadServers() {
    await mcpStore.fetchServers()
}

async function addServer() {
    if (!newServer.value.name) {
        notify('warn', '请输入服务器名称')
        return
    }

    adding.value = true
    try {
        const config: MCPServerConfig = {
            type: newServer.value.type,
            enabled: true,
            timeout: newServer.value.timeout
        }

        if (newServer.value.type === 'local') {
            try {
                config.command = JSON.parse(newServer.value.command)
            } catch {
                notify('error', '命令格式错误，请使用 JSON 数组格式')
                adding.value = false
                return
            }
        } else {
            config.url = newServer.value.url
        }

        if (newServer.value.environment) {
            try {
                config.environment = JSON.parse(newServer.value.environment)
            } catch {
                notify('warn', '环境变量格式错误，已忽略')
            }
        }

        const success = await mcpStore.addServer(newServer.value.name, config)
        if (success) {
            notify('success', '服务器已添加并开始连接')
            showAddDialog.value = false
            resetNewServer()
            await loadServers()
        } else {
            notify('error', '添加服务器失败')
        }
    } finally {
        adding.value = false
    }
}

function resetNewServer() {
    newServer.value = { ...DEFAULT_SERVER }
}

async function deleteServer() {
    if (!serverToDelete.value) return

    deleting.value = true
    const success = await mcpStore.deleteServer(serverToDelete.value.name)
    deleting.value = false

    if (success) {
        notify('success', '服务器已删除')
        showDeleteDialog.value = false
        serverToDelete.value = null
        await loadServers()
    } else {
        notify('error', '删除服务器失败')
    }
}

async function reconnectServer(name: string) {
    const success = await mcpStore.reconnectServer(name)
    if (success) {
        notify('success', '正在重新连接...')
        setTimeout(loadServers, 1000)
    } else {
        notify('error', '重新连接失败')
    }
}

async function toggleServer(name: string, enabled: boolean) {
    const success = await mcpStore.toggleServer(name, enabled)
    if (success) {
        notify('success', enabled ? '服务器已启用' : '服务器已禁用')
        await loadServers()
    } else {
        notify('error', '操作失败')
    }
}

async function viewServerDetails(server: MCPServerInfo) {
    selectedServer.value = server
    serverTools.value = []
    showDetailsDialog.value = true

    const result = await mcpStore.fetchServer(server.name)
    if (result) {
        selectedServer.value = result.server
        serverTools.value = result.tools
    }
}

function getStatusLabel(status: string): string {
    return STATUS_META[status]?.label || status
}

function getStatusSeverity(status: string): 'success' | 'info' | 'warn' | 'danger' {
    return STATUS_META[status]?.severity || 'info'
}

function formatCommand(command: string | string[]): string {
    return Array.isArray(command) ? command.join(' ') : command
}

function getServerInfo(server: MCPServerInfo) {
    return [
        { label: '工具数量', value: server.toolCount },
        ...(server.connectedAt ? [{ label: '连接时间', value: formatDateTime(server.connectedAt) }] : []),
        ...(server.error ? [{ label: '错误', value: server.error, error: true }] : [])
    ]
}

function getServerConfig(server: MCPServerInfo) {
    return [
        ...(server.config.command ? [{ label: '命令', value: formatCommand(server.config.command) }] : []),
        ...(server.config.url ? [{ label: 'URL', value: server.config.url }] : [])
    ]
}

function getServerDetails(server: MCPServerInfo) {
    return [
        { label: '名称', value: server.name },
        { label: '状态', value: getStatusLabel(server.status), status: true },
        { label: '类型', value: server.config.type },
        { label: '工具数量', value: server.toolCount }
    ]
}

onMounted(() => {
    loadServers()
    refreshInterval = window.setInterval(loadServers, 5000)
})

onUnmounted(() => {
    if (refreshInterval) {
        clearInterval(refreshInterval)
    }
})
</script>

<style scoped>
.mcp-page {
    padding: 0;
}

.mcp-sections {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.mcp-card {
    padding: 20px;
    background: var(--ui-surface-strong);
    border-radius: 12px;
    border: 1px solid var(--ui-border);
    transition: box-shadow 0.2s ease, transform 0.1s ease, border-color 0.2s ease;
}

.mcp-card:hover {
    box-shadow: var(--ui-shadow-sm);
    transform: translateY(-1px);
    border-color: var(--ui-primary-soft);
}

.mcp-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
    gap: 12px;
}

.mcp-name-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.mcp-name {
    font-weight: 600;
    font-size: 16px;
}

.mcp-type-tag {
    font-size: 12px;
    color: var(--ui-text-muted);
}

.mcp-header-actions {
    display: inline-flex;
    align-items: center;
    gap: 8px;
}

.mcp-info {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    margin-bottom: 12px;
    padding: 12px;
    background: var(--ui-surface-muted);
    border-radius: 8px;
}

.info-item {
    display: flex;
    gap: 8px;
    align-items: center;
}

.info-label {
    font-size: 13px;
    color: var(--ui-text-muted);
    font-weight: 500;
}

.info-value {
    font-size: 13px;
    color: var(--ui-text);
    font-weight: 600;
}

.error-text {
    color: var(--ui-danger);
}

.mcp-config {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.config-item {
    display: flex;
    gap: 8px;
    align-items: flex-start;
}

.config-label {
    font-size: 13px;
    color: var(--ui-text-muted);
    font-weight: 500;
    min-width: 60px;
}

.config-value {
    font-size: 12px;
    color: var(--ui-text-soft);
    background: var(--ui-surface-code);
    padding: 4px 8px;
    border-radius: 4px;
    font-family: 'Courier New', monospace;
    word-break: break-all;
}

.form-stack {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
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

.field-hint {
    font-size: 12px;
    color: var(--ui-text-faint);
    margin-top: 2px;
}

.details-section {
    margin-bottom: 24px;
}

.details-section h3 {
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 12px;
    color: var(--ui-text);
}

.details-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
}

.detail-item {
    display: flex;
    gap: 8px;
    align-items: center;
}

.detail-label {
    font-size: 13px;
    color: var(--ui-text-muted);
    font-weight: 500;
}

.detail-value {
    font-size: 13px;
    color: var(--ui-text);
    font-weight: 600;
}

.tools-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.tool-item {
    padding: 12px;
    background: var(--ui-surface-muted);
    border-radius: 8px;
    border: 1px solid var(--ui-border);
}

.tool-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--ui-text);
    font-family: 'Courier New', monospace;
    display: block;
    margin-bottom: 6px;
}

.tool-description {
    font-size: 13px;
    color: var(--ui-text-muted);
    margin: 0;
}

@media (max-width: 768px) {
    .form-stack {
        grid-template-columns: 1fr;
    }

    .mcp-header {
        flex-direction: column;
        align-items: flex-start;
    }

    .mcp-header-actions {
        align-self: stretch;
        justify-content: flex-start;
    }

    .details-grid {
        grid-template-columns: 1fr;
    }
}

</style>
