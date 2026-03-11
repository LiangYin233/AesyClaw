<template>
    <div class="mcp-page">
        <div class="page-header">
            <h1>MCP 服务器管理</h1>
            <div class="header-actions">
                <Button label="刷新" icon="pi pi-refresh" outlined @click="loadServers" :loading="loading" />
                <Button label="添加服务器" icon="pi pi-plus" @click="showAddDialog = true" />
            </div>
        </div>

        <div v-if="servers.length > 0" class="mcp-sections">
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
                            @click="confirmDelete(server)"
                            v-tooltip.top="'删除服务器'"
                        />
                    </div>
                </div>

                <div class="mcp-info">
                    <div class="info-item">
                        <span class="info-label">工具数量:</span>
                        <span class="info-value">{{ server.toolCount }}</span>
                    </div>
                    <div class="info-item" v-if="server.connectedAt">
                        <span class="info-label">连接时间:</span>
                        <span class="info-value">{{ formatDate(server.connectedAt) }}</span>
                    </div>
                    <div class="info-item" v-if="server.error">
                        <span class="info-label">错误:</span>
                        <span class="info-value error-text">{{ server.error }}</span>
                    </div>
                </div>

                <div class="mcp-config">
                    <div class="config-item" v-if="server.config.command">
                        <span class="config-label">命令:</span>
                        <code class="config-value">{{ formatCommand(server.config.command) }}</code>
                    </div>
                    <div class="config-item" v-if="server.config.url">
                        <span class="config-label">URL:</span>
                        <code class="config-value">{{ server.config.url }}</code>
                    </div>
                </div>
            </div>
        </div>

        <div v-else-if="!loading" class="empty-state">
            <Message severity="info" :closable="false">
                暂无 MCP 服务器，点击右上角"添加服务器"创建
            </Message>
        </div>

        <div v-else class="loading-container">
            <ProgressSpinner />
        </div>

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
                        <div class="detail-item">
                            <span class="detail-label">名称:</span>
                            <span class="detail-value">{{ selectedServer.name }}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">状态:</span>
                            <Tag
                                :value="getStatusLabel(selectedServer.status)"
                                :severity="getStatusSeverity(selectedServer.status)"
                            />
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">类型:</span>
                            <span class="detail-value">{{ selectedServer.config.type }}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">工具数量:</span>
                            <span class="detail-value">{{ selectedServer.toolCount }}</span>
                        </div>
                    </div>
                </div>

                <div class="details-section">
                    <h3>工具列表</h3>
                    <div v-if="serverTools.length > 0" class="tools-list">
                        <div v-for="tool in serverTools" :key="tool.name" class="tool-item">
                            <div class="tool-header">
                                <span class="tool-name">{{ tool.name }}</span>
                            </div>
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

        <!-- Delete Confirmation Dialog -->
        <Dialog v-model:visible="showDeleteDialog" header="确认删除" :style="{ width: '450px' }" modal>
            <div class="confirm-content">
                <i class="pi pi-exclamation-triangle" style="font-size: 2rem; color: var(--red-500)"></i>
                <span>确定要删除服务器 <strong>{{ serverToDelete?.name }}</strong> 吗？此操作无法撤销。</span>
            </div>
            <template #footer>
                <Button label="取消" text @click="showDeleteDialog = false" />
                <Button label="删除" severity="danger" @click="deleteServer" :loading="deleting" />
            </template>
        </Dialog>

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
import ProgressSpinner from 'primevue/progressspinner'
import Dialog from 'primevue/dialog'
import Tag from 'primevue/tag'

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

const newServer = ref({
    name: '',
    type: 'local' as 'local' | 'http',
    command: '["npx", "-y", "@modelcontextprotocol/server-filesystem", "/path/to/files"]',
    url: '',
    environment: '{}',
    timeout: 120000
})

let refreshInterval: number | null = null

async function loadServers() {
    await mcpStore.fetchServers()
}

async function addServer() {
    if (!newServer.value.name) {
        toast.add({ severity: 'warn', summary: '警告', detail: '请输入服务器名称', life: 3000 })
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
                toast.add({ severity: 'error', summary: '错误', detail: '命令格式错误，请使用 JSON 数组格式', life: 3000 })
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
                toast.add({ severity: 'warn', summary: '警告', detail: '环境变量格式错误，已忽略', life: 3000 })
            }
        }

        const success = await mcpStore.addServer(newServer.value.name, config)
        if (success) {
            toast.add({ severity: 'success', summary: '成功', detail: '服务器已添加并开始连接', life: 3000 })
            showAddDialog.value = false
            resetNewServer()
            await loadServers()
        } else {
            toast.add({ severity: 'error', summary: '错误', detail: '添加服务器失败', life: 3000 })
        }
    } finally {
        adding.value = false
    }
}

function resetNewServer() {
    newServer.value = {
        name: '',
        type: 'local',
        command: '["npx", "-y", "@modelcontextprotocol/server-filesystem", "/path/to/files"]',
        url: '',
        environment: '{}',
        timeout: 120000
    }
}

function confirmDelete(server: MCPServerInfo) {
    serverToDelete.value = server
    showDeleteDialog.value = true
}

async function deleteServer() {
    if (!serverToDelete.value) return

    deleting.value = true
    const success = await mcpStore.deleteServer(serverToDelete.value.name)
    deleting.value = false

    if (success) {
        toast.add({ severity: 'success', summary: '成功', detail: '服务器已删除', life: 3000 })
        showDeleteDialog.value = false
        serverToDelete.value = null
        await loadServers()
    } else {
        toast.add({ severity: 'error', summary: '错误', detail: '删除服务器失败', life: 3000 })
    }
}

async function reconnectServer(name: string) {
    const success = await mcpStore.reconnectServer(name)
    if (success) {
        toast.add({ severity: 'success', summary: '成功', detail: '正在重新连接...', life: 3000 })
        setTimeout(loadServers, 1000)
    } else {
        toast.add({ severity: 'error', summary: '错误', detail: '重新连接失败', life: 3000 })
    }
}

async function toggleServer(name: string, enabled: boolean) {
    const success = await mcpStore.toggleServer(name, enabled)
    if (success) {
        toast.add({ severity: 'success', summary: '成功', detail: enabled ? '服务器已启用' : '服务器已禁用', life: 3000 })
        await loadServers()
    } else {
        toast.add({ severity: 'error', summary: '错误', detail: '操作失败', life: 3000 })
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
    const labels: Record<string, string> = {
        connecting: '连接中',
        connected: '已连接',
        failed: '失败',
        disconnected: '已断开'
    }
    return labels[status] || status
}

function getStatusSeverity(status: string): 'success' | 'info' | 'warn' | 'danger' {
    const severities: Record<string, 'success' | 'info' | 'warn' | 'danger'> = {
        connecting: 'info',
        connected: 'success',
        failed: 'danger',
        disconnected: 'warn'
    }
    return severities[status] || 'info'
}

function formatDate(dateStr: string): string {
    const date = new Date(dateStr)
    return date.toLocaleString('zh-CN')
}

function formatCommand(command: string | string[]): string {
    if (Array.isArray(command)) {
        return command.join(' ')
    }
    return command
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

.header-actions {
    display: flex;
    gap: 8px;
}

.mcp-sections {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.mcp-card {
    padding: 20px;
    background: #ffffff;
    border-radius: 12px;
    border: 1px solid #e2e8f0;
    transition: box-shadow 0.2s ease, transform 0.1s ease, border-color 0.2s ease;
}

.mcp-card:hover {
    box-shadow: 0 6px 18px rgba(15, 23, 42, 0.08);
    transform: translateY(-1px);
    border-color: #bfdbfe;
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
    color: #64748b;
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
    background: #f8fafc;
    border-radius: 8px;
}

.info-item {
    display: flex;
    gap: 8px;
    align-items: center;
}

.info-label {
    font-size: 13px;
    color: #64748b;
    font-weight: 500;
}

.info-value {
    font-size: 13px;
    color: #1e293b;
    font-weight: 600;
}

.error-text {
    color: #dc2626;
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
    color: #64748b;
    font-weight: 500;
    min-width: 60px;
}

.config-value {
    font-size: 12px;
    color: #475569;
    background: #f1f5f9;
    padding: 4px 8px;
    border-radius: 4px;
    font-family: 'Courier New', monospace;
    word-break: break-all;
}

.empty-state {
    padding: 48px 0;
}

.loading-container {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 48px;
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
    color: #475569;
}

.field-hint {
    font-size: 12px;
    color: #94a3b8;
    margin-top: 2px;
}

.details-section {
    margin-bottom: 24px;
}

.details-section h3 {
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 12px;
    color: #1e293b;
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
    color: #64748b;
    font-weight: 500;
}

.detail-value {
    font-size: 13px;
    color: #1e293b;
    font-weight: 600;
}

.tools-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.tool-item {
    padding: 12px;
    background: #f8fafc;
    border-radius: 8px;
    border: 1px solid #e2e8f0;
}

.tool-header {
    margin-bottom: 6px;
}

.tool-name {
    font-size: 14px;
    font-weight: 600;
    color: #1e293b;
    font-family: 'Courier New', monospace;
}

.tool-description {
    font-size: 13px;
    color: #64748b;
    margin: 0;
}

.confirm-content {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 16px 0;
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

@media (prefers-color-scheme: dark) {
    .mcp-card {
        background: #1e293b;
        border-color: #334155;
    }

    .mcp-info {
        background: #0f172a;
    }

    .info-value {
        color: #e2e8f0;
    }

    .config-value {
        background: #0f172a;
        color: #cbd5e1;
    }

    .tool-item {
        background: #0f172a;
        border-color: #334155;
    }

    .tool-name {
        color: #e2e8f0;
    }

    .details-section h3 {
        color: #e2e8f0;
    }

    .detail-value {
        color: #e2e8f0;
    }
}
</style>
