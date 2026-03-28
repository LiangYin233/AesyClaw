<template>
  <div class="flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden xl:flex-row">
    <div v-if="sidebarVisible" class="fixed inset-0 z-20 bg-slate-900/30 backdrop-blur-[2px] md:left-64 xl:hidden" @click="sidebarVisible = false" />

    <DialogueSidebar
      :visible="sidebarVisible"
      :sessions-loading="sessionsLoading"
      :sessions="filteredSessionItems"
      :active-session-key="activeSessionKey"
      :session-filter="sessionFilter"
      :agent-filter="agentFilter"
      :visible-agent-filters="visibleAgentFilters"
      @update:session-filter="sessionFilter = $event"
      @update:agent-filter="agentFilter = $event"
      @open-session="openSession"
    />

    <section class="flex min-w-0 flex-1 flex-col overflow-hidden bg-surface">
      <div class="flex min-h-0 flex-1 flex-col">
        <header class="border-b border-outline-variant/10 bg-surface-container-lowest px-4 py-3 md:px-5 md:py-4">
          <div class="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <button
                  class="inline-flex size-8 items-center justify-center rounded-lg text-on-surface-variant transition hover:bg-surface-container-high xl:hidden"
                  type="button"
                  @click="sidebarVisible = !sidebarVisible"
                >
                  <AppIcon name="menu" size="sm" />
                </button>
                <h1 class="truncate text-sm font-extrabold tracking-[0.01em] text-on-surface">{{ headerTitle }}</h1>
                <span v-if="resolvedSessionKey" class="tech-text rounded-full bg-surface-container-low px-2 py-0.5 text-[10px] text-outline">{{ resolvedSessionKey }}</span>
              </div>
              <div class="tech-text mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-outline">
                <span>渠道: {{ activeDetail?.channel || draftChannelLabel }}</span>
                <span>chatId: {{ activeDetail?.chatId || draftChatIdLabel }}</span>
                <span>消息数: {{ activeDetail?.messageCount ?? 0 }}</span>
              </div>
            </div>

            <div class="flex flex-wrap items-center gap-2">
              <button
                class="rounded-lg px-3 py-1.5 text-xs font-bold transition hover:bg-surface-container-low"
                type="button"
                @click="copySessionKey"
              >
                复制会话键
              </button>
              <button
                class="rounded-lg bg-surface-container-low px-3 py-1.5 text-xs font-bold text-on-surface-variant transition hover:bg-surface-container-high"
                type="button"
                @click="openSessionsPage"
              >
                查看会话列表
              </button>
            </div>
          </div>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-6">
          <DialogueTimeline
            :detail-loading="detailLoading"
            :detail-error="detailError"
            :messages="displayMessages"
            :session-key="resolvedSessionKey"
            :agent-name="activeDetail?.agentName"
            :channel="activeDetail?.channel"
          />
        </div>

        <footer class="border-t border-outline-variant/10 bg-surface-container-lowest px-4 py-3 md:px-6 md:py-5">
          <DialogueComposer
            v-model="draft"
            :sending="sending"
            :agent-name="activeDetail?.agentName"
            :session-key="resolvedSessionKey"
            @send="sendMessage"
          />
        </footer>
      </div>
    </section>

    <aside class="hidden w-72 shrink-0 border-l border-outline-variant/10 bg-surface-container-low xl:flex xl:flex-col">
      <div class="space-y-8 overflow-y-auto p-6 scrollbar-hide">
        <section class="space-y-4">
          <h3 class="cn-kicker text-outline">当前状态</h3>
          <div class="rounded-xl bg-surface-container-lowest p-4 shadow-sm ring-1 ring-outline-variant/6">
            <div class="space-y-3 text-xs">
              <div class="flex items-center justify-between">
                <span class="text-on-surface-variant">活动 Agent</span>
                <span class="font-bold text-primary">{{ activeDetail?.agentName || 'main' }}</span>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-on-surface-variant">上下文队列</span>
                <span class="tech-text">{{ activeDetail?.messageCount || 0 }} 条</span>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-on-surface-variant">会话模式</span>
                <span class="italic text-outline">{{ resolvedSessionKey ? '已绑定' : '待创建' }}</span>
              </div>
              <div class="pt-2">
                <div class="h-1 w-full overflow-hidden rounded-full bg-surface-container-high">
                  <div class="h-full rounded-full bg-primary" :style="{ width: contextWidth }"></div>
                </div>
                <div class="mt-1.5 flex justify-between">
                  <span class="text-[10px] text-outline">Context Window</span>
                  <span class="tech-text text-[10px] text-outline">{{ contextLabel }}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="space-y-4">
          <h3 class="cn-kicker text-outline">会话控制</h3>
          <div class="space-y-2">
            <button class="flex w-full items-center justify-between rounded-xl bg-surface-container-lowest p-3 text-xs font-medium transition hover:bg-white" type="button" @click="openSessionsPage">
              <span class="flex items-center gap-3">
                <AppIcon name="sessions" size="sm" class="text-outline" />
                切换会话
              </span>
              <AppIcon name="arrowRight" size="sm" class="text-outline" />
            </button>
            <button class="flex w-full items-center justify-between rounded-xl bg-surface-container-lowest p-3 text-xs font-medium transition hover:bg-white" type="button" @click="goToMemory">
              <span class="flex items-center gap-3">
                <AppIcon name="memory" size="sm" class="text-outline" />
                查看记忆
              </span>
              <AppIcon name="arrowRight" size="sm" class="text-outline" />
            </button>
          </div>
        </section>

        <section class="space-y-4">
          <h3 class="cn-kicker text-error">维护操作</h3>
          <div class="space-y-2">
            <button
              class="flex w-full items-center gap-3 rounded-xl p-3 text-xs font-medium text-on-surface-variant transition hover:bg-error-container/20 hover:text-error"
              :disabled="!resolvedSessionKey || deleting"
              type="button"
              @click="deleteCurrentSession"
            >
              <AppIcon name="delete" size="sm" />
              删除当前会话
            </button>
            <button
              class="flex w-full items-center gap-3 rounded-xl p-3 text-xs font-medium text-on-surface-variant transition hover:bg-surface-container-high"
              type="button"
              @click="startFreshDialogue"
            >
              <AppIcon name="plus" size="sm" />
              新建空白对话
            </button>
          </div>
        </section>
      </div>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppIcon from '@/components/AppIcon.vue';
import DialogueComposer from '@/components/dialogue/DialogueComposer.vue';
import DialogueSidebar from '@/components/dialogue/DialogueSidebar.vue';
import DialogueTimeline from '@/components/dialogue/DialogueTimeline.vue';
import { buildTokenQuery, getRouteToken } from '@/lib/auth';
import { useDialogueState } from '@/composables/useDialogueState';
import type { Session } from '@/lib/types';

const route = useRoute();
const router = useRouter();
const token = getRouteToken(route);

const draft = ref('');
const sessionFilter = ref('');
const agentFilter = ref<'all' | string>('all');
const sidebarVisible = ref(false);

const routeSessionKey = computed(() => {
  const raw = route.params.sessionKey;
  return typeof raw === 'string' ? raw : '';
});
const resolvedSessionKey = computed(() => routeSessionKey.value || '');
const activeSessionKey = computed(() => resolvedSessionKey.value || '');
const {
  sessions,
  sessionsLoading,
  detailLoading,
  sending,
  deleting,
  detailError,
  activeDetail,
  displayMessages,
  visibleAgentFilters,
  headerTitle,
  contextWidth,
  contextLabel,
  draftChannelLabel,
  draftChatIdLabel,
  sessionTitle,
  sessionStateLabel,
  sessionPreview,
  ensureDraftSessionKey,
  resetDraftSessionKey,
  sendMessage: sendDialogueMessage,
  deleteCurrentSession: removeCurrentSession
} = useDialogueState(token, resolvedSessionKey);

const filteredSessions = computed(() => {
  const query = sessionFilter.value.trim().toLowerCase();
  return sessions.value
    .filter((session) => {
      const matchesAgent = agentFilter.value === 'all' || (session.agentName || 'main') === agentFilter.value;
      const haystack = [session.key, session.channel, session.chatId, session.agentName, sessionPreview(session)]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return matchesAgent && (!query || haystack.includes(query));
    });
});
const filteredSessionItems = computed(() => filteredSessions.value.map((session) => ({
  session,
  title: sessionTitle(session),
  state: sessionStateLabel(session),
  preview: sessionPreview(session)
})));

async function openSession(key: string) {
  sidebarVisible.value = false;
  await router.push({
    path: `/dialogue/${key}`,
    query: buildTokenQuery(route.query, token),
  });
}

async function sendMessage() {
  const message = draft.value.trim();
  if (!message) return;

  const { createdSessionKey } = await sendDialogueMessage(message);
  draft.value = '';

  if (createdSessionKey) {
    await router.replace({
      path: `/dialogue/${createdSessionKey}`,
      query: buildTokenQuery(route.query, token),
    });
  }
}

async function deleteCurrentSession() {
  if (!resolvedSessionKey.value) return;
  if (!window.confirm(`确认删除会话 ${resolvedSessionKey.value} 吗？`)) return;

  const success = await removeCurrentSession(resolvedSessionKey.value);
  if (!success) {
    return;
  }

  await router.replace({
    path: '/dialogue',
    query: buildTokenQuery(route.query, token),
  });
}

function startFreshDialogue() {
  resetDraftSessionKey();
  draft.value = '';
  sidebarVisible.value = false;
  router.push({
    path: '/dialogue',
    query: buildTokenQuery(route.query, token),
  });
}

function openSessionsPage() {
  router.push({
    path: '/sessions',
    query: buildTokenQuery(route.query, token),
  });
}

function goToMemory() {
  router.push({
    path: '/memory',
    query: buildTokenQuery(route.query, token),
  });
}

async function copySessionKey() {
  const target = resolvedSessionKey.value || ensureDraftSessionKey();
  if (!target || !navigator.clipboard) return;
  await navigator.clipboard.writeText(target).catch(() => undefined);
}
</script>
