<template>
    <div class="memory-page">
        <PageHeader title="记忆" subtitle="按聊天对象查看摘要和长期事实">
            <template #actions>
                <Button
                    icon="pi pi-trash"
                    label="全部清空"
                    severity="danger"
                    text
                    @click="clearAllVisible = true"
                    :disabled="entries.length === 0"
                    aria-label="清空全部记忆"
                />
                <Button
                    icon="pi pi-refresh"
                    label="刷新"
                    @click="loadMemory"
                    :loading="loading"
                    aria-label="刷新记忆列表"
                />
            </template>
        </PageHeader>

        <LoadingContainer
            :loading="loading && entries.length === 0"
            :error="error"
            :on-retry="loadMemory"
        >
            <EmptyState
                v-if="entries.length === 0"
                icon="pi pi-bookmark"
                title="暂无记忆"
                description="当前还没有可展示的摘要或长期事实"
            />

            <div v-else class="memory-list">
                <Card v-for="entry in entries" :key="entry.key" class="memory-card">
                    <template #content>
                        <div class="memory-card-header">
                            <div>
                                <div class="memory-title">{{ entry.channel }} / {{ entry.chatId }}</div>
                                <div class="memory-meta">
                                    <Tag :value="entry.channel" severity="primary" />
                                    <Tag :value="`事实 ${entry.factCount}`" severity="info" />
                                    <Tag :value="`会话 ${entry.sessionCount}`" severity="secondary" />
                                    <Tag
                                        :value="entry.summaryCount > 0 ? `摘要 ${entry.summaryCount}` : '无摘要'"
                                        :severity="entry.summaryCount > 0 ? 'success' : 'secondary'"
                                    />
                                </div>
                            </div>

                            <div class="memory-actions">
                                <Button
                                    icon="pi pi-trash"
                                    label="清空"
                                    text
                                    severity="danger"
                                    @click="selectedEntry = entry; clearEntryVisible = true"
                                    aria-label="清空该聊天对象的记忆"
                                />
                            </div>
                        </div>

                        <div class="memory-section">
                            <div class="section-label">长期事实</div>
                            <ul v-if="entry.facts.length > 0" class="facts-list">
                                <li v-for="fact in entry.facts" :key="fact">{{ fact }}</li>
                            </ul>
                            <div v-else class="text-muted">暂无长期事实</div>
                        </div>

                        <div class="memory-section">
                            <div class="section-label">会话摘要</div>
                            <div v-if="entry.sessions.length === 0" class="text-muted">暂无会话摘要</div>
                            <div v-else class="session-summary-list">
                                <div
                                    v-for="session in entry.sessions"
                                    :key="session.sessionKey"
                                    class="session-summary-item"
                                >
                                    <div class="session-summary-header">
                                        <div class="session-summary-meta">
                                            <span class="memory-key">{{ session.sessionKey }}</span>
                                            <Tag
                                                v-if="session.uuid"
                                                :value="session.uuid"
                                                severity="secondary"
                                            />
                                            <Tag
                                                :value="session.summary ? `已摘要消息 ${session.summarizedMessageCount}` : '无摘要'"
                                                :severity="session.summary ? 'success' : 'secondary'"
                                            />
                                        </div>
                                        <Button
                                            icon="pi pi-comments"
                                            label="继续聊天"
                                            text
                                            @click="navigateWithToken(router, `/chat/${session.sessionKey}`, routeToken)"
                                            aria-label="继续该会话聊天"
                                        />
                                    </div>
                                    <div v-if="session.summary" class="summary-content">{{ session.summary }}</div>
                                    <div v-else class="text-muted">该会话暂无摘要</div>
                                </div>
                            </div>
                        </div>

                        <div v-if="entry.updatedAt" class="memory-updated">
                            最近更新：{{ formatDateTime(entry.updatedAt) }}
                        </div>
                    </template>
                </Card>
            </div>
        </LoadingContainer>

        <ConfirmDialog
            v-model:visible="clearEntryVisible"
            title="确认清空"
            :message="`确定要清空 ${selectedEntry?.channel || ''} / ${selectedEntry?.chatId || ''} 的全部记忆吗？这会清空该聊天对象下的长期事实和所有会话摘要。`"
            :loading="clearing"
            confirm-label="清空"
            confirm-severity="danger"
            :on-confirm="clearEntry"
        />

        <ConfirmDialog
            v-model:visible="clearAllVisible"
            title="确认清空全部记忆"
            message="确定要清空全部摘要和长期事实吗？此操作无法撤销。"
            :loading="clearing"
            confirm-label="全部清空"
            confirm-severity="danger"
            :on-confirm="clearAll"
        />
    </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import type { MemoryEntry } from '../types/api'
import { useMemoryStore } from '../stores'
import { useToast } from '../composables/useToast'
import { announceToScreenReader } from '../composables/useA11y'
import PageHeader from '../components/common/PageHeader.vue'
import LoadingContainer from '../components/common/LoadingContainer.vue'
import EmptyState from '../components/common/EmptyState.vue'
import ConfirmDialog from '../components/common/ConfirmDialog.vue'
import { formatDateTime } from '../utils/formatters'
import Button from 'primevue/button'
import Card from 'primevue/card'
import Tag from 'primevue/tag'
import { getRouteToken, navigateWithToken } from '../utils/auth'

const router = useRouter()
const route = useRoute()
const routeToken = getRouteToken(route)
const toast = useToast()
const memoryStore = useMemoryStore()
const { entries, loading, error } = storeToRefs(memoryStore)

const selectedEntry = ref<MemoryEntry | null>(null)
const clearEntryVisible = ref(false)
const clearAllVisible = ref(false)
const clearing = ref(false)

async function loadMemory() {
    const items = await memoryStore.fetchEntries()

    if (error.value) {
        toast.error('加载失败', error.value)
        return
    }

    announceToScreenReader(`已加载 ${items.length} 个聊天对象的记忆`, 'polite')
}

async function clearEntry() {
    if (!selectedEntry.value) {
        return
    }

    clearing.value = true
    const success = await memoryStore.deleteEntry(selectedEntry.value.key)

    if (success) {
        toast.success('清空成功', '该聊天对象的记忆已清空')
        clearEntryVisible.value = false
        selectedEntry.value = null
        await loadMemory()
    } else {
        toast.error('清空失败', error.value || '无法清空该聊天对象的记忆')
    }

    clearing.value = false
}

async function clearAll() {
    clearing.value = true
    const success = await memoryStore.clearAll()

    if (success) {
        toast.success('清空成功', '全部记忆已清空')
        clearAllVisible.value = false
        selectedEntry.value = null
        await loadMemory()
    } else {
        toast.error('清空失败', error.value || '无法清空全部记忆')
    }

    clearing.value = false
}

onMounted(() => {
    loadMemory()
})
</script>

<style scoped>
.memory-page {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.memory-list {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
    gap: 16px;
}

.memory-card {
    height: 100%;
}

.memory-card-header {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: flex-start;
    margin-bottom: 16px;
}

.memory-title {
    font-size: 16px;
    font-weight: 600;
    color: #1e293b;
    margin-bottom: 8px;
    word-break: break-all;
}

.memory-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.memory-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: flex-end;
}

.memory-key {
    font-family: monospace;
    word-break: break-all;
}

.memory-section {
    margin-bottom: 16px;
}

.section-label {
    font-size: 13px;
    font-weight: 600;
    color: #64748b;
    margin-bottom: 8px;
}

.session-summary-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.session-summary-item {
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 12px;
    background: #f8fafc;
}

.session-summary-header {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: flex-start;
    margin-bottom: 8px;
}

.session-summary-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
}

.summary-content {
    color: #1e293b;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
}

.facts-list {
    margin: 0;
    padding-left: 20px;
    color: #1e293b;
    line-height: 1.6;
}

.facts-list li + li {
    margin-top: 6px;
}

.memory-updated {
    font-size: 12px;
    color: #94a3b8;
}

.text-muted {
    color: #94a3b8;
}

@media (max-width: 768px) {
    .memory-list {
        grid-template-columns: 1fr;
    }

    .memory-card-header,
    .session-summary-header {
        flex-direction: column;
    }
}

@media (prefers-color-scheme: dark) {
    .memory-title,
    .summary-content,
    .facts-list {
        color: #f1f5f9;
    }

    .section-label {
        color: #94a3b8;
    }

    .session-summary-item {
        background: #1e293b;
        border-color: #334155;
    }
}
</style>
