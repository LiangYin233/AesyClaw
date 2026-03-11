<template>
    <div class="sessions-page">
        <PageHeader title="会话管理" subtitle="管理所有聊天会话">
            <template #actions>
                <Button
                    icon="pi pi-refresh"
                    label="刷新"
                    @click="loadSessions"
                    :loading="sessionsStore.loading"
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

                    <DataTable
                        v-else
                        :data="sessionsStore.sortedSessions"
                        :columns="columns"
                        row-key="key"
                        aria-label="会话列表"
                    >
                        <template #cell-channel="{ value }">
                            <Tag
                                :value="value || '-'"
                                severity="primary"
                                :aria-label="`渠道：${value || '未知'}`"
                            />
                        </template>

                        <template #cell-chatId="{ data }">
                            <span class="session-key">{{ data.chatId || data.key }}</span>
                        </template>

                        <template #cell-uuid="{ value }">
                            <Tag
                                v-if="value"
                                :value="value"
                                severity="secondary"
                                :aria-label="`UUID：${value}`"
                            />
                            <span v-else class="text-muted">-</span>
                        </template>

                        <template #cell-messageCount="{ value }">
                            <Tag
                                :value="value.toString()"
                                severity="info"
                                :aria-label="`消息数：${value}`"
                            />
                        </template>

                        <template #cell-actions="{ data }">
                            <div class="action-buttons">
                                <Button
                                    icon="pi pi-comments"
                                    text
                                    rounded
                                    title="继续聊天"
                                    @click="continueChat(data.key)"
                                    aria-label="继续聊天"
                                />
                                <Button
                                    icon="pi pi-eye"
                                    text
                                    rounded
                                    title="查看详情"
                                    @click="viewSession(data)"
                                    aria-label="查看会话详情"
                                />
                                <Button
                                    icon="pi pi-trash"
                                    text
                                    rounded
                                    severity="danger"
                                    title="删除"
                                    @click="confirmDelete(data)"
                                    aria-label="删除会话"
                                />
                            </div>
                        </template>
                    </DataTable>
                </LoadingContainer>
            </template>
        </Card>

        <!-- Session Detail Dialog -->
        <Dialog
            v-model:visible="detailVisible"
            :header="`会话详情: ${selectedSession?.key}`"
            modal
            class="detail-dialog"
            role="dialog"
            aria-labelledby="detail-dialog-title"
        >
            <LoadingContainer
                :loading="loadingDetails"
                loading-text="正在加载会话详情..."
            >
                <div v-if="selectedSessionDetails" class="detail-messages" role="log">
                    <div
                        v-for="(msg, index) in selectedSessionDetails.messages"
                        :key="index"
                        class="detail-message"
                        :class="msg.role"
                        role="article"
                    >
                        <div class="message-role">{{ msg.role === 'user' ? '用户' : 'AI 助手' }}</div>
                        <div class="message-content">{{ msg.content }}</div>
                    </div>
                </div>
            </LoadingContainer>
        </Dialog>

        <!-- Delete Confirmation Dialog -->
        <Dialog
            v-model:visible="deleteVisible"
            header="确认删除"
            modal
            role="alertdialog"
            aria-labelledby="delete-dialog-title"
        >
            <p>
                确定要删除会话
                <span class="session-key">{{ selectedSession?.key }}</span>
                吗？此操作无法撤销。
            </p>
            <template #footer>
                <Button
                    label="取消"
                    text
                    @click="deleteVisible = false"
                    aria-label="取消删除"
                />
                <Button
                    label="删除"
                    severity="danger"
                    @click="doDelete"
                    :loading="deleting"
                    aria-label="确认删除会话"
                />
            </template>
        </Dialog>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSessionsStore } from '../stores/sessions'
import { useToast } from '../composables/useToast'
import { announceToScreenReader } from '../composables/useA11y'
import type { Session } from '../types/api'
import PageHeader from '../components/common/PageHeader.vue'
import LoadingContainer from '../components/common/LoadingContainer.vue'
import EmptyState from '../components/common/EmptyState.vue'
import DataTable from '../components/common/DataTable.vue'
import Button from 'primevue/button'
import Card from 'primevue/card'
import Tag from 'primevue/tag'
import Dialog from 'primevue/dialog'
import { getRouteToken, navigateWithToken } from '../utils/auth'

const router = useRouter()
const route = useRoute()
const routeToken = getRouteToken(route)
const sessionsStore = useSessionsStore()
const toast = useToast()

const columns = [
    { field: 'channel', header: '渠道' },
    { field: 'chatId', header: '聊天ID' },
    { field: 'uuid', header: 'UUID' },
    { field: 'messageCount', header: '消息数' },
    { field: 'actions', header: '操作' }
]

const detailVisible = ref(false)
const deleteVisible = ref(false)
const selectedSession = ref<Session | null>(null)
const selectedSessionDetails = ref<any>(null)
const loadingDetails = ref(false)
const deleting = ref(false)

async function loadSessions() {
    const success = await sessionsStore.fetchSessions()
    if (success) {
        announceToScreenReader(`已加载 ${sessionsStore.sessionCount} 个会话`, 'polite')
    } else {
        toast.error('加载失败', sessionsStore.error || '无法加载会话列表')
    }
}

function continueChat(key: string) {
    navigateWithToken(router, `/chat/${key}`, routeToken)
}

async function viewSession(session: Session) {
    selectedSession.value = session
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
    selectedSession.value = session
    deleteVisible.value = true
}

async function doDelete() {
    if (!selectedSession.value) return

    deleting.value = true
    const success = await sessionsStore.deleteSession(selectedSession.value.key)

    if (success) {
        toast.success('删除成功', '会话已删除')
        announceToScreenReader('会话已删除', 'polite')
        deleteVisible.value = false
    } else {
        toast.error('删除失败', sessionsStore.error || '无法删除会话')
    }

    deleting.value = false
}

onMounted(() => {
    loadSessions()
})
</script>

<style scoped>
.sessions-page {
    padding: 0;
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

@media (prefers-color-scheme: dark) {
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
