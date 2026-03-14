<template>
    <div class="sessions-page">
        <PageHeader title="会话管理" subtitle="管理所有聊天会话">
            <template #actions>
                <Button
                    icon="pi pi-refresh"
                    label="刷新"
                    @click="loadSessions"
                    :loading="sessionsStore.loading"
                    :disabled="bulkDeleting || deleting"
                    aria-label="刷新会话列表"
                />
            </template>
        </PageHeader>

        <Card>
            <template #content>
                <LoadingContainer
                    :loading="sessionsStore.loading && sessionsStore.sessions.length === 0"
                    :error="sessionsStore.error"
                    :on-retry="loadSessions"
                >
                    <EmptyState
                        v-if="sessionsStore.sessions.length === 0"
                        icon="pi pi-comments"
                        title="暂无会话"
                        description="还没有任何聊天会话"
                    >
                        <template #actions>
                            <Button
                                label="开始聊天"
                                icon="pi pi-plus"
                                @click="navigateWithToken(router, '/chat', routeToken)"
                                aria-label="开始新的聊天"
                            />
                        </template>
                    </EmptyState>

                    <div v-else class="sessions-table-section">
                        <div class="bulk-toolbar" role="toolbar" aria-label="批量管理会话">
                            <div class="bulk-toolbar__summary">
                                已选择
                                <span class="bulk-toolbar__count">{{ selectedCount }}</span>
                                个会话
                            </div>
                            <div class="bulk-toolbar__actions">
                                <Button
                                    label="全选当前列表"
                                    icon="pi pi-check-square"
                                    text
                                    @click="selectAllVisibleSessions"
                                    :disabled="allVisibleSelected || bulkDeleting || deleting"
                                    aria-label="全选当前列表中的会话"
                                />
                                <Button
                                    label="清空选择"
                                    icon="pi pi-times"
                                    text
                                    @click="clearSelection"
                                    :disabled="!hasSelectedSessions || bulkDeleting || deleting"
                                    aria-label="清空已选择的会话"
                                />
                                <Button
                                    label="批量删除"
                                    icon="pi pi-trash"
                                    severity="danger"
                                    @click="openBulkDeleteDialog"
                                    :disabled="!hasSelectedSessions || bulkDeleting || deleting"
                                    aria-label="批量删除已选择的会话"
                                />
                            </div>
                        </div>

                        <DataTable
                            :data="sessionsStore.sortedSessions"
                            :columns="columns"
                            row-key="key"
                            aria-label="会话列表"
                        >
                            <template #cell-select="{ data }">
                                <Checkbox
                                    binary
                                    :model-value="isSelected(data.key)"
                                    :disabled="bulkDeleting"
                                    :input-id="`session-select-${data.key}`"
                                    :aria-label="`选择会话 ${data.chatId || data.key}`"
                                    @update:model-value="value => toggleSelection(data.key, value)"
                                />
                            </template>

                            <template #cell-agentName="{ value }">
                                <Tag :value="value || 'main'" severity="contrast" />
                            </template>

                            <template #cell-channel="{ value }">
                                <Tag :value="value || '-'" severity="primary" :aria-label="`渠道：${value || '未知'}`" />
                            </template>

                            <template #cell-chatId="{ data }">
                                <span class="session-key">{{ data.chatId || data.key }}</span>
                            </template>

                            <template #cell-uuid="{ value }">
                                <Tag v-if="value" :value="value" severity="secondary" :aria-label="`UUID：${value}`" />
                                <span v-else class="text-muted">-</span>
                            </template>

                            <template #cell-messageCount="{ value }">
                                <Tag :value="value.toString()" severity="info" :aria-label="`消息数：${value}`" />
                            </template>

                            <template #cell-actions="{ data }">
                                <div class="action-buttons">
                                    <Button icon="pi pi-comments" text rounded title="继续聊天" @click="continueChat(data.key)" :disabled="bulkDeleting" aria-label="继续聊天" />
                                    <Button icon="pi pi-eye" text rounded title="查看详情" @click="viewSession(data)" :disabled="bulkDeleting" aria-label="查看会话详情" />
                                    <Button icon="pi pi-trash" text rounded severity="danger" title="删除" @click="confirmDelete(data)" :disabled="bulkDeleting || deleting" aria-label="删除会话" />
                                </div>
                            </template>
                        </DataTable>
                    </div>
                </LoadingContainer>
            </template>
        </Card>

        <Dialog v-model:visible="detailVisible" :header="`会话详情: ${selectedSession?.key}`" modal class="detail-dialog" role="dialog" aria-labelledby="detail-dialog-title">
            <LoadingContainer :loading="loadingDetails" loading-text="正在加载会话详情...">
                <div v-if="selectedSessionDetails" class="detail-messages" role="log">
                    <div v-for="(msg, index) in selectedSessionDetails.messages" :key="index" class="detail-message" :class="msg.role" role="article">
                        <div class="message-role">{{ msg.role === 'user' ? '用户' : 'AI 助手' }}</div>
                        <div class="message-content">{{ msg.content }}</div>
                    </div>
                </div>
            </LoadingContainer>
        </Dialog>

        <ConfirmDialog
            v-model:visible="deleteVisible"
            title="确认删除"
            :message="`确定要删除会话 ${selectedSession?.key || ''} 吗？此操作无法撤销。`"
            :loading="deleting"
            confirm-label="删除"
            confirm-severity="danger"
            :on-confirm="doDelete"
        />

        <ConfirmDialog
            v-model:visible="bulkDeleteVisible"
            title="确认批量删除"
            :message="`确定要批量删除已选择的 ${selectedCount} 个会话吗？此操作无法撤销。`"
            :loading="bulkDeleting"
            confirm-label="批量删除"
            confirm-severity="danger"
            :on-confirm="doBulkDelete"
        />
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSessionsStore } from '../stores/sessions'
import { useToast } from '../composables/useToast'
import { announceToScreenReader } from '../composables/useA11y'
import type { Session } from '../types/api'
import PageHeader from '../components/common/PageHeader.vue'
import LoadingContainer from '../components/common/LoadingContainer.vue'
import EmptyState from '../components/common/EmptyState.vue'
import DataTable from '../components/common/DataTable.vue'
import ConfirmDialog from '../components/common/ConfirmDialog.vue'
import Button from 'primevue/button'
import Card from 'primevue/card'
import Tag from 'primevue/tag'
import Dialog from 'primevue/dialog'
import Checkbox from 'primevue/checkbox'
import { getRouteToken, navigateWithToken } from '../utils/auth'

const router = useRouter()
const route = useRoute()
const routeToken = getRouteToken(route)
const sessionsStore = useSessionsStore()
const toast = useToast()

const columns = [
    { field: 'select', header: '选择', bodyClass: 'selection-cell' },
    { field: 'agentName', header: 'Agent' },
    { field: 'channel', header: '渠道' },
    { field: 'chatId', header: '聊天ID' },
    { field: 'uuid', header: 'UUID' },
    { field: 'messageCount', header: '消息数' },
    { field: 'actions', header: '操作' }
]

const detailVisible = ref(false)
const deleteVisible = ref(false)
const bulkDeleteVisible = ref(false)
const selectedSession = ref<Session | null>(null)
const selectedSessionDetails = ref<any>(null)
const loadingDetails = ref(false)
const deleting = ref(false)
const bulkDeleting = ref(false)
const selectedKeys = ref<string[]>([])

const visibleSessionKeys = computed(() => sessionsStore.sortedSessions.map(session => session.key))
const selectedCount = computed(() => selectedKeys.value.length)
const hasSelectedSessions = computed(() => selectedKeys.value.length > 0)
const allVisibleSelected = computed(() => {
    return visibleSessionKeys.value.length > 0
        && visibleSessionKeys.value.every(key => selectedKeys.value.includes(key))
})

async function loadSessions() {
    const success = await sessionsStore.fetchSessions()
    if (success) {
        clearSelection()
        announceToScreenReader(`已加载 ${sessionsStore.sessionCount} 个会话`, 'polite')
    } else {
        toast.error('加载失败', sessionsStore.error || '无法加载会话列表')
    }
}

function continueChat(key: string) {
    navigateWithToken(router, `/chat/${key}`, routeToken)
}

function isSelected(key: string) {
    return selectedKeys.value.includes(key)
}

function toggleSelection(key: string, value: boolean) {
    if (value) {
        if (!selectedKeys.value.includes(key)) {
            selectedKeys.value = [...selectedKeys.value, key]
        }
        return
    }

    selectedKeys.value = selectedKeys.value.filter(selectedKey => selectedKey !== key)
}

function selectAllVisibleSessions() {
    selectedKeys.value = [...visibleSessionKeys.value]
}

function clearSelection() {
    selectedKeys.value = []
}

function removeSelectedKeys(keys: string[]) {
    const deletedKeys = new Set(keys)
    selectedKeys.value = selectedKeys.value.filter(key => !deletedKeys.has(key))
}

function handleDeletedSessions(keys: string[]) {
    if (keys.length === 0) {
        return
    }

    removeSelectedKeys(keys)

    if (selectedSession.value && keys.includes(selectedSession.value.key)) {
        detailVisible.value = false
        deleteVisible.value = false
        selectedSession.value = null
        selectedSessionDetails.value = null
        loadingDetails.value = false
    }
}

async function viewSession(session: Session) {
    selectedSession.value = session
    selectedSessionDetails.value = null
    loadingDetails.value = true
    detailVisible.value = true

    const details = await sessionsStore.fetchSession(session.key)

    if (details) {
        selectedSessionDetails.value = details
    } else {
        toast.error('加载失败', '无法加载会话详情')
        detailVisible.value = false
    }

    loadingDetails.value = false
}

function confirmDelete(session: Session) {
    if (bulkDeleting.value) {
        return
    }

    selectedSession.value = session
    deleteVisible.value = true
}

function openBulkDeleteDialog() {
    if (!hasSelectedSessions.value || deleting.value) {
        return
    }

    bulkDeleteVisible.value = true
}

async function doDelete() {
    if (!selectedSession.value) return

    deleting.value = true
    const deletedKey = selectedSession.value.key
    const success = await sessionsStore.deleteSession(deletedKey)

    if (success) {
        handleDeletedSessions([deletedKey])
        toast.success('删除成功', '会话已删除')
        announceToScreenReader('会话已删除', 'polite')
        deleteVisible.value = false
    } else {
        toast.error('删除失败', sessionsStore.error || '无法删除会话')
    }

    deleting.value = false
}

async function doBulkDelete() {
    if (!hasSelectedSessions.value) {
        return
    }

    bulkDeleting.value = true
    const result = await sessionsStore.deleteSessions(selectedKeys.value)
    const successCount = result.successKeys.length
    const failedCount = result.failed.length

    handleDeletedSessions(result.successKeys)
    selectedKeys.value = result.failed.map(item => item.key)
    bulkDeleteVisible.value = false

    const summary = `批量删除完成`
    const detail = `成功 ${successCount} 条，失败 ${failedCount} 条`

    if (failedCount === 0) {
        toast.success(summary, detail)
        announceToScreenReader(`${summary}，${detail}`, 'polite')
    } else if (successCount === 0) {
        toast.error('批量删除失败', result.failed[0]?.error || '无法删除已选择的会话')
        announceToScreenReader(`${summary}，${detail}`, 'assertive')
    } else {
        toast.warn(summary, detail)
        announceToScreenReader(`${summary}，${detail}`, 'assertive')
    }

    bulkDeleting.value = false
}

onMounted(() => {
    loadSessions()
})
</script>

<style scoped>
.sessions-page {
    padding: 0;
}

.sessions-table-section {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.bulk-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    padding: 12px 16px;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    background: #f8fafc;
}

.bulk-toolbar__summary {
    color: #475569;
    font-size: 14px;
}

.bulk-toolbar__count {
    font-weight: 700;
    color: #0f172a;
}

.bulk-toolbar__actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
}

.session-key {
    font-family: monospace;
    font-size: 13px;
}

.text-muted {
    color: #94a3b8;
}

.action-buttons {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
}

:deep(.selection-cell) {
    width: 72px;
}

.detail-dialog {
    width: 600px;
    max-width: 90vw;
}

.detail-messages {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 400px;
    overflow-y: auto;
}

.detail-message {
    padding: 8px 12px;
    border-radius: 8px;
}

.detail-message.user {
    background: #f1f5f9;
    margin-left: 32px;
}

.detail-message.assistant {
    background: #e0f2fe;
    margin-right: 32px;
}

.message-role {
    font-size: 12px;
    color: #64748b;
    margin-bottom: 4px;
    font-weight: 500;
}

.message-content {
    font-size: 14px;
    white-space: pre-wrap;
}

@media (max-width: 768px) {
    .bulk-toolbar {
        align-items: stretch;
    }

    .bulk-toolbar__actions {
        width: 100%;
    }
}

@media (prefers-color-scheme: dark) {
    .bulk-toolbar {
        background: #0f172a;
        border-color: #334155;
    }

    .bulk-toolbar__summary {
        color: #cbd5e1;
    }

    .bulk-toolbar__count {
        color: #f8fafc;
    }

    .detail-message.user {
        background: #334155;
    }

    .detail-message.assistant {
        background: #1e3a5f;
    }

    .message-role {
        color: #94a3b8;
    }
}
</style>
