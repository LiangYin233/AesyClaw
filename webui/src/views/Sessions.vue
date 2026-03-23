<template>
  <div class="p-5 md:p-8">
    <div class="mx-auto max-w-[1680px]">
      <header class="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p class="cn-kicker text-outline">会话</p>
          <h1 class="cn-page-title mt-2 text-on-surface">会话总台</h1>
          <p class="cn-body mt-2 max-w-3xl text-sm text-on-surface-variant">集中查看当前会话、消息负载与当前路由角色。</p>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <button
            class="inline-flex items-center gap-2 rounded-xl border border-outline-variant/20 bg-surface-container-lowest px-4 py-2.5 text-sm font-semibold text-on-surface shadow-sm transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-60"
            type="button"
            :disabled="loading"
            @click="loadSessionsPage"
          >
            <AppIcon name="refresh" size="sm" />
            刷新
          </button>
          <button
            class="inline-flex items-center gap-2 rounded-xl border border-error/20 bg-error-container/70 px-4 py-2.5 text-sm font-semibold text-on-error-container transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            type="button"
            :disabled="!selectedKeys.length || deleting"
            @click="deleteSelectedSessions"
          >
            <AppIcon name="delete" size="sm" />
            删除已选 {{ selectedKeys.length ? `(${selectedKeys.length})` : '' }}
          </button>
        </div>
      </header>

      <div v-if="error" class="mb-6 rounded-2xl border border-error/20 bg-error-container/60 px-5 py-4 text-sm text-on-error-container">
        <div class="flex items-start gap-3">
          <AppIcon name="warning" />
          <div>
            <p class="font-bold">会话数据加载失败</p>
            <p class="mt-1 leading-6">{{ error }}</p>
          </div>
        </div>
      </div>

      <div class="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <article class="hairline-card rounded-2xl p-5">
          <div class="mb-3 flex items-start justify-between">
            <AppIcon name="sessions" class="text-primary" />
            <span class="rounded-full bg-primary-fixed px-2 py-0.5 text-[10px] font-bold text-on-primary-fixed">当前</span>
          </div>
          <p class="cn-kicker text-outline">会话总数</p>
          <p class="cn-metric mt-1 text-on-surface">{{ sessions.length }}</p>
          <p class="tech-text mt-2 text-xs text-on-surface-variant">含所有渠道会话键与当前消息上下文</p>
        </article>

        <article class="hairline-card rounded-2xl p-5">
          <div class="mb-3 flex items-start justify-between">
            <AppIcon name="dialogue" class="text-tertiary" />
            <span class="rounded-full bg-tertiary-fixed px-2 py-0.5 text-[10px] font-bold text-on-tertiary-fixed">高频</span>
          </div>
          <p class="cn-kicker text-outline">WebUI 会话</p>
          <p class="cn-metric mt-1 text-on-surface">{{ webuiSessionCount }}</p>
          <p class="mt-2 text-xs text-on-surface-variant">直接来自 `/dialogue` 的交互上下文</p>
        </article>

        <article class="hairline-card rounded-2xl p-5">
          <div class="mb-3 flex items-start justify-between">
            <AppIcon name="panel" class="text-sky-600" />
            <span class="rounded-full bg-surface-container-low px-2 py-0.5 text-[10px] font-bold text-outline">聚合</span>
          </div>
          <p class="cn-kicker text-outline">消息总量</p>
          <p class="cn-metric mt-1 text-on-surface">{{ totalMessages }}</p>
          <p class="mt-2 text-xs text-on-surface-variant">平均 {{ averageMessageCount }} 条 / 会话</p>
        </article>

        <article class="hairline-card rounded-2xl p-5">
          <div class="mb-3 flex items-start justify-between">
            <AppIcon name="agents" class="text-orange-600" />
            <span class="rounded-full bg-surface-container-low px-2 py-0.5 text-[10px] font-bold text-outline">路由</span>
          </div>
          <p class="cn-kicker text-outline">活跃 Agent</p>
          <p class="cn-metric mt-1 text-on-surface">{{ activeAgentCount }}</p>
          <p class="mt-2 text-xs text-on-surface-variant">当前列表里被路由到的角色数量</p>
        </article>
      </div>

      <div class="flex flex-col gap-6 2xl:flex-row">
        <section class="min-w-0 flex-1">
          <div class="hairline-card overflow-hidden rounded-[1.6rem]">
            <div class="flex flex-col gap-3 border-b border-outline-variant/20 px-5 py-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 class="cn-section-title text-on-surface">会话列表</h2>
                <p class="mt-1 text-sm text-on-surface-variant">点击任意会话可查看完整消息流、当前路由角色或继续对话。</p>
              </div>
              <p class="tech-text text-xs text-on-surface-variant">已选 {{ selectedKeys.length }} / {{ sessions.length }}</p>
            </div>

            <div v-if="loading" class="px-5 py-12 text-center text-sm text-on-surface-variant">正在加载会话数据...</div>

            <template v-else-if="sortedSessions.length">
              <div class="hidden overflow-x-auto lg:block">
                <table class="min-w-full border-collapse text-left text-sm">
                  <thead class="bg-surface-container-low/70 text-outline">
                    <tr>
                      <th class="w-12 px-5 py-4">
                        <input
                          :checked="allSelected"
                          class="size-4 rounded border border-outline-variant/50 bg-transparent"
                          type="checkbox"
                          @change="handleToggleAll"
                        />
                      </th>
                      <th class="px-5 py-4 text-[11px] font-bold tracking-[0.08em]">会话标识</th>
                      <th class="px-5 py-4 text-[11px] font-bold tracking-[0.08em]">渠道与路由</th>
                      <th class="px-5 py-4 text-[11px] font-bold tracking-[0.08em]">Agent</th>
                      <th class="px-5 py-4 text-[11px] font-bold tracking-[0.08em]">消息数</th>
                      <th class="px-5 py-4 text-[11px] font-bold tracking-[0.08em]">动作</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="session in sortedSessions"
                      :key="session.key"
                      class="cursor-pointer border-t border-outline-variant/14 transition-colors hover:bg-surface-container-low/55"
                      :class="detail?.key === session.key ? 'bg-primary-fixed/55' : ''"
                      @click="openSession(session.key)"
                    >
                      <td class="px-5 py-4" @click.stop>
                        <input
                          :checked="selectedSet.has(session.key)"
                          class="size-4 rounded border border-outline-variant/50 bg-transparent"
                          type="checkbox"
                          @change="handleToggleSelection(session.key, $event)"
                        />
                      </td>
                      <td class="px-5 py-4">
                        <div class="tech-text text-xs text-on-surface">{{ session.key }}</div>
                        <div class="mt-2 flex flex-wrap gap-2 text-[11px] text-outline">
                          <span class="rounded-full bg-surface-container-low px-2 py-1">{{ session.channel || '-' }}</span>
                          <span v-if="session.uuid" class="tech-text rounded-full bg-surface-container-low px-2 py-1">{{ session.uuid }}</span>
                        </div>
                      </td>
                      <td class="px-5 py-4">
                        <div class="tech-text text-xs text-on-surface-variant">chatId: {{ session.chatId || '-' }}</div>
                        <div class="mt-2 text-xs text-on-surface-variant">{{ channelDescription(session.channel) }}</div>
                      </td>
                      <td class="px-5 py-4">
                        <span class="rounded-full bg-primary-fixed px-2.5 py-1 text-xs font-semibold text-on-primary-fixed">{{ session.agentName || 'main' }}</span>
                      </td>
                      <td class="px-5 py-4">
                        <div class="cn-section-title text-base text-on-surface">{{ session.messageCount }}</div>
                        <div class="text-xs text-on-surface-variant">已记录消息</div>
                      </td>
                      <td class="px-5 py-4">
                        <div class="flex flex-wrap gap-2">
                          <button class="rounded-lg border border-outline-variant/25 px-3 py-2 text-xs font-semibold text-on-surface transition hover:bg-surface-container-low" type="button" @click.stop="goToDialogue(session.key)">
                            继续对话
                          </button>
                          <button class="rounded-lg border border-error/20 px-3 py-2 text-xs font-semibold text-error transition hover:bg-error-container/60" type="button" @click.stop="deleteSingleSession(session.key)">
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div class="space-y-3 p-4 lg:hidden">
                <article
                  v-for="session in sortedSessions"
                  :key="session.key"
                  class="rounded-2xl border border-outline-variant/18 bg-surface-container-lowest p-4 transition-colors"
                  :class="detail?.key === session.key ? 'border-primary/30 bg-primary-fixed/40' : ''"
                >
                  <div class="flex items-start gap-3">
                    <input
                      :checked="selectedSet.has(session.key)"
                      class="mt-1 size-4 rounded border border-outline-variant/50 bg-transparent"
                      type="checkbox"
                      @change="handleToggleSelection(session.key, $event)"
                    />
                    <button class="min-w-0 flex-1 text-left" type="button" @click="openSession(session.key)">
                      <p class="tech-text break-all text-xs text-on-surface">{{ session.key }}</p>
                      <div class="mt-3 flex flex-wrap gap-2 text-[11px] text-outline">
                        <span class="rounded-full bg-surface-container-low px-2 py-1">{{ session.channel || '-' }}</span>
                        <span class="rounded-full bg-primary-fixed px-2 py-1 text-on-primary-fixed">{{ session.agentName || 'main' }}</span>
                        <span class="rounded-full bg-surface-container-low px-2 py-1">{{ session.messageCount }} 条消息</span>
                      </div>
                      <p class="mt-3 text-sm text-on-surface-variant">{{ channelDescription(session.channel) }}</p>
                    </button>
                  </div>
                  <div class="mt-4 flex gap-2">
                    <button class="flex-1 rounded-xl border border-outline-variant/25 px-3 py-2 text-sm font-semibold text-on-surface" type="button" @click="goToDialogue(session.key)">继续对话</button>
                    <button class="rounded-xl border border-error/20 px-3 py-2 text-sm font-semibold text-error" type="button" @click="deleteSingleSession(session.key)">删除</button>
                  </div>
                </article>
              </div>
            </template>

            <div v-else class="px-5 py-14 text-center">
              <p class="cn-section-title text-on-surface">当前没有活跃会话</p>
              <p class="cn-body mt-2 text-sm text-on-surface-variant">你可以前往对话页新建一轮交互，或等待其他渠道写入新的会话上下文。</p>
              <button class="mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-primary/20" type="button" @click="goToDialogue()">
                <AppIcon name="rocket" size="sm" />
                打开对话页
              </button>
            </div>
          </div>
        </section>

        <aside class="hidden w-[430px] shrink-0 2xl:block">
          <div class="sidebar-rail-scroll-2xl">
            <section class="hairline-card flex h-[calc(100vh-6rem)] min-h-[38rem] flex-col overflow-hidden rounded-[1.6rem] p-5">
              <SessionDetailPanel
                :detail="detail"
                :detail-error="detailError"
                :detail-loading="detailLoading"
                @open-dialogue="goToDialogue(detail?.key)"
                @delete-session="handleDeleteDetailSession"
              />
            </section>
          </div>
        </aside>
      </div>

      <div v-if="detailVisibleOnMobile" class="fixed inset-0 z-50 2xl:hidden">
        <div class="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" @click="closeDetail"></div>
        <div class="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col bg-surface-container-lowest shadow-2xl">
          <section class="min-h-0 flex-1 overflow-y-auto p-5">
            <div class="mb-4 flex items-center justify-between">
              <h2 class="cn-section-title text-on-surface">会话详情</h2>
              <button class="rounded-xl border border-outline-variant/20 p-2 text-outline transition hover:bg-surface-container-low hover:text-on-surface" type="button" @click="closeDetail">
                <AppIcon name="close" size="sm" />
              </button>
            </div>
            <SessionDetailPanel
              :detail="detail"
              :detail-error="detailError"
              :detail-loading="detailLoading"
              @open-dialogue="goToDialogue(detail?.key)"
              @delete-session="handleDeleteDetailSession"
            />
          </section>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppIcon from '@/components/AppIcon.vue';
import SessionDetailPanel from '@/components/SessionDetailPanel.vue';
import { apiDelete, apiGet } from '@/lib/api';
import { getRouteToken } from '@/lib/auth';
import { formatNumber } from '@/lib/format';
import type { Session, SessionDetail } from '@/lib/types';

const route = useRoute();
const router = useRouter();
const token = getRouteToken(route);

const sessions = ref<Session[]>([]);
const loading = ref(false);
const deleting = ref(false);
const error = ref('');
const detail = ref<SessionDetail | null>(null);
const detailLoading = ref(false);
const detailError = ref('');
const selectedKeys = ref<string[]>([]);

const sortedSessions = computed(() => [...sessions.value].sort((a, b) => b.messageCount - a.messageCount || a.key.localeCompare(b.key)));
const selectedSet = computed(() => new Set(selectedKeys.value));
const allSelected = computed(() => sortedSessions.value.length > 0 && sortedSessions.value.every((session) => selectedSet.value.has(session.key)));
const totalMessages = computed(() => formatNumber(sessions.value.reduce((sum, session) => sum + session.messageCount, 0)));
const averageMessageCount = computed(() => {
  if (!sessions.value.length) return '0';
  return (sessions.value.reduce((sum, session) => sum + session.messageCount, 0) / sessions.value.length).toFixed(1);
});
const webuiSessionCount = computed(() => formatNumber(sessions.value.filter((session) => session.channel === 'webui').length));
const activeAgentCount = computed(() => formatNumber(new Set(sessions.value.map((session) => session.agentName || 'main')).size));
const detailVisibleOnMobile = computed(() => detailLoading.value || Boolean(detail.value) || Boolean(detailError.value));

async function loadSessionsPage() {
  loading.value = true;
  error.value = '';

  const sessionsResult = await apiGet<{ sessions: Session[] }>('/api/sessions', token);

  if (sessionsResult.error) {
    error.value = sessionsResult.error || '加载失败';
  }

  sessions.value = sessionsResult.data?.sessions || [];
  selectedKeys.value = selectedKeys.value.filter((key) => sessions.value.some((session) => session.key === key));

  if (detail.value && sessions.value.some((session) => session.key === detail.value?.key)) {
    await openSession(detail.value.key, false);
  } else if (detail.value) {
    closeDetail();
  }

  loading.value = false;
}

async function openSession(key: string, showLoading = true) {
  if (showLoading) {
    detailLoading.value = true;
  }
  detailError.value = '';

  const result = await apiGet<SessionDetail>(`/api/sessions/${encodeURIComponent(key)}`, token);
  if (result.error || !result.data) {
    detail.value = null;
    detailError.value = result.error || '无法加载会话详情';
    detailLoading.value = false;
    return;
  }

  detail.value = result.data;
  detailLoading.value = false;
}

function closeDetail() {
  detail.value = null;
  detailError.value = '';
  detailLoading.value = false;
}

function channelDescription(channel?: string) {
  if (!channel) return '未标记渠道';
  if (channel === 'webui') return '来自新版 WebUI 对话入口';
  return `来自 ${channel} 渠道的会话上下文`;
}

function handleToggleSelection(key: string, event: Event) {
  const checked = (event.target as HTMLInputElement).checked;
  selectedKeys.value = checked
    ? [...new Set([...selectedKeys.value, key])]
    : selectedKeys.value.filter((item) => item !== key);
}

function handleToggleAll(event: Event) {
  const checked = (event.target as HTMLInputElement).checked;
  selectedKeys.value = checked ? sortedSessions.value.map((session) => session.key) : [];
}

function goToDialogue(sessionKey?: string) {
  router.push({
    path: sessionKey ? `/dialogue/${sessionKey}` : '/dialogue',
    query: token ? { token } : {},
  });
}

async function deleteSingleSession(key: string) {
  if (!window.confirm(`确认删除会话 ${key} 吗？此操作无法撤销。`)) {
    return;
  }

  deleting.value = true;
  const result = await apiDelete<{ success: true }>(`/api/sessions/${encodeURIComponent(key)}`, token);
  deleting.value = false;

  if (result.error) {
    error.value = result.error;
    return;
  }

  if (detail.value?.key === key) {
    closeDetail();
  }

  selectedKeys.value = selectedKeys.value.filter((item) => item !== key);
  await loadSessionsPage();
}

async function deleteSelectedSessions() {
  if (!selectedKeys.value.length) {
    return;
  }

  if (!window.confirm(`确认删除已选的 ${selectedKeys.value.length} 个会话吗？此操作无法撤销。`)) {
    return;
  }

  deleting.value = true;
  const results = await Promise.all(selectedKeys.value.map((key) => apiDelete<{ success: true }>(`/api/sessions/${encodeURIComponent(key)}`, token)));
  deleting.value = false;

  const failed = results.find((result) => result.error);
  error.value = failed?.error || '';
  closeDetail();
  selectedKeys.value = [];
  await loadSessionsPage();
}

function handleDeleteDetailSession() {
  if (detail.value?.key) {
    deleteSingleSession(detail.value.key);
  }
}

onMounted(() => {
  loadSessionsPage();
});
</script>
