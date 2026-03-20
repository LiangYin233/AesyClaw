<template>
  <div class="p-5 md:p-8">
    <div class="mx-auto max-w-[1680px]">
      <header class="mb-8 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p class="cn-kicker text-outline">记忆</p>
          <h1 class="cn-page-title mt-2 text-on-surface">记忆管理台</h1>
          <p class="cn-body mt-2 max-w-3xl text-sm text-on-surface-variant">
            在这里集中查看会话摘要、长期事实和最近的记忆操作，方便快速了解系统记住了什么。
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <button class="inline-flex items-center gap-2 rounded-xl border border-outline-variant/20 bg-surface-container-lowest px-4 py-2.5 text-sm font-semibold text-on-surface shadow-sm transition hover:bg-surface-container-high" type="button" :disabled="loading" @click="loadMemory">
            <AppIcon name="refresh" size="sm" />
            刷新
          </button>
          <button class="inline-flex items-center gap-2 rounded-xl border border-error/20 bg-error-container/70 px-4 py-2.5 text-sm font-semibold text-on-error-container transition hover:opacity-90" type="button" :disabled="!selectedItem || deleting" @click="clearSelected">
            <AppIcon name="delete" size="sm" />
            清空当前会话记忆
          </button>
          <button class="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-primary to-primary-container px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-primary/20 transition hover:opacity-90" type="button" :disabled="deleting || !items.length" @click="clearAll">
            <AppIcon name="warning" size="sm" />
            清空全部记忆
          </button>
        </div>
      </header>

      <div v-if="error" class="mb-6 rounded-2xl border border-error/20 bg-error-container/60 px-5 py-4 text-sm text-on-error-container">
        <div class="flex items-start gap-3">
          <AppIcon name="warning" />
          <div>
            <p class="font-bold">记忆数据加载失败</p>
            <p class="mt-1 leading-6">{{ error }}</p>
          </div>
        </div>
      </div>

      <div class="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <article class="hairline-card rounded-2xl p-5">
          <div class="mb-3 flex items-start justify-between">
            <AppIcon name="memory" class="text-primary" />
            <span class="rounded-full bg-primary-fixed px-2 py-0.5 text-[10px] font-bold text-on-primary-fixed">摘要</span>
          </div>
          <p class="cn-kicker text-outline">会话摘要</p>
          <p class="cn-metric mt-1 text-on-surface">{{ totalSummaries }}</p>
          <p class="mt-2 text-xs text-on-surface-variant">有摘要的会话上下文数量</p>
        </article>

        <article class="hairline-card rounded-2xl p-5">
          <div class="mb-3 flex items-start justify-between">
            <AppIcon name="observability" class="text-tertiary" />
            <span class="rounded-full bg-tertiary-fixed px-2 py-0.5 text-[10px] font-bold text-on-tertiary-fixed">事实</span>
          </div>
          <p class="cn-kicker text-outline">长期事实</p>
          <p class="cn-metric mt-1 text-on-surface">{{ totalFacts }}</p>
          <p class="mt-2 text-xs text-on-surface-variant">当前所有记忆条目总数</p>
        </article>

        <article class="hairline-card rounded-2xl p-5">
          <div class="mb-3 flex items-start justify-between">
            <AppIcon name="sessions" class="text-sky-600" />
            <span class="rounded-full bg-surface-container-low px-2 py-0.5 text-[10px] font-bold text-outline">会话</span>
          </div>
          <p class="cn-kicker text-outline">关联会话</p>
          <p class="cn-metric mt-1 text-on-surface">{{ totalSessions }}</p>
          <p class="mt-2 text-xs text-on-surface-variant">已经写入记忆数据的会话快照</p>
        </article>

        <article class="hairline-card rounded-2xl p-5">
          <div class="mb-3 flex items-start justify-between">
            <AppIcon name="history" class="text-orange-600" />
            <span class="rounded-full bg-surface-container-low px-2 py-0.5 text-[10px] font-bold text-outline">审计</span>
          </div>
          <p class="cn-kicker text-outline">近期操作</p>
          <p class="cn-metric mt-1 text-on-surface">{{ totalOperations }}</p>
          <p class="mt-2 text-xs text-on-surface-variant">来自最近一轮内存维护与人工清理</p>
        </article>
      </div>

      <div class="mb-6 flex w-fit items-center gap-1 rounded-full bg-surface-container-low p-1">
        <button class="rounded-full px-5 py-2 text-xs font-bold tracking-[0.08em] transition" :class="activeTab === 'summary' ? 'bg-primary-fixed text-on-primary-fixed shadow-sm' : 'text-on-surface-variant hover:bg-surface-container-high'" type="button" @click="activeTab = 'summary'">
          会话摘要
        </button>
        <button class="rounded-full px-5 py-2 text-xs font-bold tracking-[0.08em] transition" :class="activeTab === 'facts' ? 'bg-primary-fixed text-on-primary-fixed shadow-sm' : 'text-on-surface-variant hover:bg-surface-container-high'" type="button" @click="activeTab = 'facts'">
          长期事实
        </button>
      </div>

      <div class="flex flex-col gap-6 xl:flex-row">
        <div class="min-w-0 flex-1 space-y-6">
          <section class="hairline-card overflow-hidden rounded-[1.6rem]">
            <div class="flex items-center justify-between border-b border-outline-variant/18 px-5 py-4">
              <div>
                <h2 class="cn-section-title text-on-surface">{{ activeTab === 'summary' ? '会话上下文摘要' : '长期事实总览' }}</h2>
                <p class="mt-1 text-sm text-on-surface-variant">
                  {{ activeTab === 'summary' ? '按会话聚合摘要、条目和更新时间。' : '按会话聚合事实数量、置信度和最近操作。' }}
                </p>
              </div>
              <p class="tech-text text-xs text-on-surface-variant">{{ filteredItems.length }} 个对象</p>
            </div>

            <div v-if="loading" class="px-5 py-14 text-center text-sm text-on-surface-variant">正在加载记忆数据...</div>

            <div v-else-if="filteredItems.length" class="divide-y divide-outline-variant/12">
              <button
                v-for="item in filteredItems"
                :key="item.key"
                class="flex w-full flex-col gap-4 px-5 py-5 text-left transition hover:bg-surface-container-low/60 md:flex-row md:items-start"
                :class="selectedKey === item.key ? 'bg-primary-fixed/45' : 'bg-transparent'"
                type="button"
                @click="selectedKey = item.key"
              >
                <div class="w-full shrink-0 md:w-40">
                  <p class="tech-text text-[11px] font-bold text-primary">{{ item.chatId || item.key }}</p>
                  <p class="mt-1 text-[11px] text-outline">渠道：{{ item.channel }}</p>
                </div>
                <div class="min-w-0 flex-1">
                  <div class="mb-2 flex flex-wrap items-center gap-2">
                    <span class="rounded-full bg-surface-container-low px-2 py-1 text-[10px] font-bold text-outline">{{ item.sessionCount }} 个会话</span>
                    <span class="rounded-full bg-surface-container-low px-2 py-1 text-[10px] font-bold text-outline">{{ item.activeEntryCount }} 条活跃事实</span>
                    <span class="rounded-full bg-surface-container-low px-2 py-1 text-[10px] font-bold text-outline">{{ item.summaryCount }} 条摘要</span>
                  </div>
                  <p class="text-sm leading-6 text-on-surface-variant">
                    {{ activeTab === 'summary' ? memoryPreview(item) : factPreview(item) }}
                  </p>
                </div>
                <div class="shrink-0 text-left md:text-right">
                  <p class="tech-text text-[11px] text-on-surface">{{ formatRelativeTime(item.updatedAt) }}</p>
                  <p class="mt-1 text-[11px] text-outline">最近更新</p>
                </div>
              </button>
            </div>

            <div v-else class="px-5 py-14 text-center">
              <p class="cn-section-title text-on-surface">当前没有可展示的记忆条目</p>
              <p class="mt-2 text-sm text-on-surface-variant">等系统跑出摘要或长期事实后，这里会自动进入新的工作台视图。</p>
            </div>
          </section>

          <section class="hairline-card overflow-hidden rounded-[1.6rem]">
            <div class="flex items-center justify-between border-b border-outline-variant/18 px-5 py-4">
              <div>
                <h2 class="cn-section-title text-on-surface">高置信度事实</h2>
                <p class="mt-1 text-sm text-on-surface-variant">针对当前选中会话展示长期事实与置信度。</p>
              </div>
              <p class="tech-text text-xs text-on-surface-variant">{{ selectedEntries.length }} 条</p>
            </div>

            <div v-if="selectedItem && selectedEntries.length" class="overflow-x-auto">
              <table class="min-w-full border-collapse text-left text-sm">
                <thead class="bg-surface-container-low/70 text-outline">
                  <tr>
                    <th class="px-5 py-4 text-[11px] font-bold tracking-[0.08em]">内容片段</th>
                    <th class="px-5 py-4 text-[11px] font-bold tracking-[0.08em]">类型</th>
                    <th class="px-5 py-4 text-[11px] font-bold tracking-[0.08em]">置信度</th>
                    <th class="px-5 py-4 text-[11px] font-bold tracking-[0.08em]">最近出现</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-outline-variant/12">
                  <tr v-for="entry in selectedEntries" :key="entry.id" class="hover:bg-surface-container-low/55">
                    <td class="px-5 py-4 text-sm text-on-surface">{{ entry.content }}</td>
                    <td class="px-5 py-4">
                      <span class="rounded-full bg-primary-fixed px-2 py-1 text-[10px] font-bold text-on-primary-fixed">{{ entry.kind }}</span>
                    </td>
                    <td class="px-5 py-4">
                      <div class="flex items-center gap-3">
                        <div class="h-1.5 w-20 overflow-hidden rounded-full bg-outline-variant/25">
                          <div class="h-full rounded-full bg-primary" :style="{ width: `${Math.max(4, Math.min(100, entry.confidence * 100))}%` }"></div>
                        </div>
                        <span class="tech-text text-xs text-on-surface">{{ entry.confidence.toFixed(2) }}</span>
                      </div>
                    </td>
                    <td class="px-5 py-4 tech-text text-xs text-on-surface-variant">{{ formatDateTime(entry.lastSeenAt || entry.updatedAt) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div v-else class="px-5 py-12 text-center text-sm text-on-surface-variant">当前选中对象还没有长期事实条目。</div>
          </section>
        </div>

        <aside class="w-full shrink-0 xl:w-[390px]">
          <div class="sidebar-rail-scroll space-y-6">
            <section class="rounded-[1.6rem] bg-surface-container-low p-6">
              <h3 class="cn-kicker text-outline">维护动作</h3>
              <div class="mt-5 space-y-3">
                <button class="flex w-full items-center justify-between rounded-xl bg-surface-container-lowest px-4 py-3 text-left text-sm font-semibold text-on-surface transition hover:bg-surface-container-high" type="button" @click="loadMemory">
                  <span>刷新记忆索引</span>
                  <AppIcon name="refresh" size="sm" class="text-primary" />
                </button>
                <button class="flex w-full items-center justify-between rounded-xl bg-surface-container-lowest px-4 py-3 text-left text-sm font-semibold text-on-surface transition hover:bg-surface-container-high" type="button" :disabled="!latestSessionKey" @click="openDialogue">
                  <span>进入最近会话</span>
                  <AppIcon name="arrowRight" size="sm" class="text-primary" />
                </button>
                <button class="flex w-full items-center justify-between rounded-xl bg-surface-container-lowest px-4 py-3 text-left text-sm font-semibold text-on-surface transition hover:bg-surface-container-high" type="button" :disabled="!selectedItem" @click="clearSelected">
                  <span>清理当前记忆</span>
                  <AppIcon name="delete" size="sm" class="text-error" />
                </button>
              </div>
            </section>

            <section class="hairline-card rounded-[1.6rem] p-6">
              <div class="flex items-center justify-between">
                <h3 class="cn-section-title text-on-surface">当前检视</h3>
                <span class="tech-text text-[11px] text-outline">{{ selectedItem?.channel || '-' }}</span>
              </div>
              <template v-if="selectedItem">
                <div class="mt-5 rounded-2xl bg-surface-container-low px-4 py-4">
                  <p class="tech-text break-anywhere text-xs text-primary">{{ selectedItem.chatId || selectedItem.key }}</p>
                  <p class="mt-2 text-sm leading-6 text-on-surface-variant">{{ memoryPreview(selectedItem) }}</p>
                </div>

                <div class="mt-5 space-y-3">
                  <div class="rounded-xl bg-surface-container-low px-4 py-3">
                    <p class="text-xs font-bold tracking-[0.08em] text-outline">对话级摘要</p>
                    <p class="mt-2 text-sm leading-6 text-on-surface-variant">{{ selectedItem.conversationSummary || '暂无对话级摘要。' }}</p>
                  </div>
                  <div class="rounded-xl bg-surface-container-low px-4 py-3">
                    <p class="text-xs font-bold tracking-[0.08em] text-outline">会话快照</p>
                    <div class="mt-3 space-y-2">
                      <button v-for="session in selectedItem.sessions.slice(0, 4)" :key="session.sessionKey" class="flex w-full items-center justify-between rounded-lg bg-surface-container-lowest px-3 py-2 text-left transition hover:bg-surface-container-high" type="button" @click="openDialogue(session.sessionKey)">
                        <div>
                          <p class="tech-text break-anywhere text-[11px] text-on-surface">{{ session.sessionKey }}</p>
                          <p class="mt-1 text-[11px] text-on-surface-variant">{{ session.summary ? abbreviateText(session.summary, 42) : '暂无摘要内容' }}</p>
                        </div>
                        <span class="tech-text text-[10px] text-outline">{{ session.summarizedMessageCount }} 轮</span>
                      </button>
                      <p v-if="!selectedItem.sessions.length" class="text-sm text-on-surface-variant">当前对象没有关联的会话摘要快照。</p>
                    </div>
                  </div>
                </div>
              </template>
              <p v-else class="mt-5 text-sm text-on-surface-variant">从左侧选择一条记忆对象后，这里会显示摘要和关联会话。</p>
            </section>

            <section class="rounded-[1.6rem] bg-slate-950 p-5 text-slate-100 shadow-2xl shadow-slate-900/10">
              <div class="mb-4 flex items-center justify-between">
                <h3 class="cn-kicker text-slate-500">记忆运行日志</h3>
                <span class="inline-flex size-2 rounded-full bg-emerald-500"></span>
              </div>
              <div class="max-h-72 space-y-2 overflow-y-auto pr-2">
                <p v-for="operation in selectedOperations" :key="operation.id" class="tech-text text-[11px] leading-5 text-slate-300">
                  <span class="text-slate-500">[{{ formatDateTime(operation.createdAt) }}]</span>
                  <span class="ml-2 text-sky-400">{{ operation.action }}</span>
                  <span class="ml-2">{{ operation.reason || operation.actor }}</span>
                </p>
                <p v-if="!selectedOperations.length" class="text-sm text-slate-400">当前对象还没有可展示的维护操作记录。</p>
              </div>
            </section>
          </div>
        </aside>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppIcon from '@/components/AppIcon.vue';
import { apiDelete, apiGet } from '@/lib/api';
import { getRouteToken } from '@/lib/auth';
import { abbreviateText, formatDateTime, formatRelativeTime } from '@/lib/format';
import type { MemoryConversationItem, MemoryOperation } from '@/lib/types';

const route = useRoute();
const router = useRouter();
const token = getRouteToken(route);

const items = ref<MemoryConversationItem[]>([]);
const loading = ref(false);
const deleting = ref(false);
const error = ref('');
const activeTab = ref<'summary' | 'facts'>('summary');
const selectedKey = ref('');

const filteredItems = computed(() => items.value.filter((item) => (
  activeTab.value === 'summary'
    ? Boolean(item.summaryCount || item.conversationSummary || item.sessions.some((session) => session.summary))
    : item.entries.length > 0
)));
const selectedItem = computed(() => filteredItems.value.find((item) => item.key === selectedKey.value) || filteredItems.value[0] || null);
const selectedEntries = computed(() => [...(selectedItem.value?.entries || [])].sort((left, right) => right.confidence - left.confidence));
const selectedOperations = computed<MemoryOperation[]>(() => (selectedItem.value?.recentOperations || []).slice(0, 12));
const totalFacts = computed(() => items.value.reduce((sum, item) => sum + item.entries.length, 0));
const totalSummaries = computed(() => items.value.reduce((sum, item) => sum + item.summaryCount, 0));
const totalSessions = computed(() => items.value.reduce((sum, item) => sum + item.sessionCount, 0));
const totalOperations = computed(() => items.value.reduce((sum, item) => sum + item.recentOperations.length, 0));
const latestSessionKey = computed(() => selectedItem.value?.sessions[0]?.sessionKey || '');

function memoryPreview(item: MemoryConversationItem) {
  return item.conversationSummary
    || item.sessions.find((session) => session.summary)?.summary
    || '当前会话还没有生成可展示的摘要文本。';
}

function factPreview(item: MemoryConversationItem) {
  return item.entries[0]?.content || '当前会话还没有长期事实。';
}

async function loadMemory() {
  loading.value = true;
  error.value = '';

  const result = await apiGet<{ items: MemoryConversationItem[] }>('/api/memory', token);
  if (result.error || !result.data) {
    error.value = result.error || '记忆加载失败';
    items.value = [];
    loading.value = false;
    return;
  }

  items.value = result.data.items;
  if (!items.value.some((item) => item.key === selectedKey.value)) {
    selectedKey.value = items.value[0]?.key || '';
  }
  loading.value = false;
}

async function clearSelected() {
  if (!selectedItem.value || !window.confirm(`确认清空 ${selectedItem.value.chatId || selectedItem.value.key} 的全部记忆吗？`)) {
    return;
  }

  deleting.value = true;
  const result = await apiDelete<{ success: true }>(`/api/memory/${encodeURIComponent(selectedItem.value.key)}`, token);
  deleting.value = false;

  if (result.error) {
    error.value = result.error;
    return;
  }

  await loadMemory();
}

async function clearAll() {
  if (!items.value.length || !window.confirm('确认清空全部会话摘要和长期记忆吗？这个操作不可撤销。')) {
    return;
  }

  deleting.value = true;
  const result = await apiDelete<{ success: true }>('/api/memory', token);
  deleting.value = false;

  if (result.error) {
    error.value = result.error;
    return;
  }

  await loadMemory();
}

function openDialogue(sessionKey?: string) {
  const target = sessionKey || latestSessionKey.value;
  if (!target) {
    return;
  }

  router.push({
    path: `/dialogue/${target}`,
    query: token ? { token } : {},
  });
}

onMounted(loadMemory);
</script>
