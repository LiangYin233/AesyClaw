<template>
  <div class="flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden xl:flex-row">
    <div v-if="sidebarVisible" class="fixed inset-0 z-20 bg-slate-900/30 backdrop-blur-[2px] md:left-64 xl:hidden" @click="sidebarVisible = false" />

    <aside
      class="fixed top-14 bottom-0 left-0 z-30 flex w-72 shrink-0 flex-col border-r border-outline-variant/10 bg-surface-container-low shadow-xl transition-transform md:left-64 xl:static xl:inset-auto xl:z-auto xl:w-80 xl:translate-x-0 xl:shadow-none"
      :class="sidebarVisible ? 'translate-x-0' : '-translate-x-full xl:translate-x-0'"
    >
      <div class="space-y-4 p-4">
        <div class="relative">
          <AppIcon name="search" size="sm" class="pointer-events-none absolute left-3 top-3 text-outline" />
          <input
            v-model.trim="sessionFilter"
            class="w-full rounded-xl border border-outline-variant/12 bg-surface-container-lowest px-10 py-2.5 text-sm text-on-surface outline-none transition focus:border-primary/40 focus:ring-2 focus:ring-primary-fixed"
            placeholder="筛选会话..."
            type="text"
          />
        </div>

        <div class="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          <button
            class="rounded-full px-3 py-1 text-[11px] font-bold transition"
            :class="agentFilter === 'all' ? 'bg-primary-fixed text-on-primary-fixed' : 'bg-surface-container-highest text-on-surface-variant hover:text-on-surface'"
            type="button"
            @click="agentFilter = 'all'"
          >
            全部
          </button>
          <button
            v-for="agentName in visibleAgentFilters"
            :key="agentName"
            class="rounded-full px-3 py-1 text-[11px] font-bold transition"
            :class="agentFilter === agentName ? 'bg-primary-fixed text-on-primary-fixed' : 'bg-surface-container-highest text-on-surface-variant hover:text-on-surface'"
            type="button"
            @click="agentFilter = agentName"
          >
            {{ agentName }}
          </button>
        </div>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <div v-if="sessionsLoading" class="px-3 py-10 text-center text-sm text-on-surface-variant">正在加载会话...</div>

        <div v-else-if="filteredSessions.length" class="space-y-1">
          <button
            v-for="session in filteredSessions"
            :key="session.key"
            class="w-full rounded-xl p-3 text-left transition"
            :class="activeSessionKey === session.key ? 'bg-surface-container-lowest shadow-sm ring-1 ring-primary/12' : 'hover:bg-surface-container-high'"
            type="button"
            @click="openSession(session.key)"
          >
            <div class="mb-1 flex items-start justify-between gap-3">
              <span class="truncate text-xs font-bold text-on-surface">{{ sessionTitle(session) }}</span>
              <span
                class="shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-bold"
                :class="activeSessionKey === session.key ? 'bg-primary-fixed text-on-primary-fixed' : 'bg-surface-container-highest text-outline'"
              >
                {{ sessionStateLabel(session) }}
              </span>
            </div>
            <p class="tech-text mb-2 flex items-center gap-1 text-[10px] text-outline">
              {{ session.agentName || 'main' }} · {{ session.channel || '-' }} · {{ session.messageCount }} 条消息
            </p>
            <p class="line-clamp-1 text-[11px] italic text-on-surface-variant">{{ sessionPreview(session) }}</p>
          </button>
        </div>

        <div v-else class="px-4 py-10 text-center">
          <p class="cn-section-title text-on-surface">没有匹配的会话</p>
          <p class="mt-2 text-sm text-on-surface-variant">可以清空筛选，或者直接从右侧发起一轮新对话。</p>
        </div>
      </div>
    </aside>

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
          <div class="mx-auto flex max-w-4xl flex-col gap-6">
            <div v-if="detailLoading" class="py-12 text-center text-sm text-on-surface-variant">正在加载对话内容...</div>

            <div v-else-if="detailError" class="rounded-2xl border border-error/20 bg-error-container/60 px-4 py-4 text-sm text-on-error-container">
              <p class="font-bold">对话加载失败</p>
              <p class="mt-2 leading-6">{{ detailError }}</p>
            </div>

            <template v-else-if="displayMessages.length">
              <div class="flex justify-center">
                <div class="flex max-w-sm items-center gap-2 rounded-full bg-surface-container-low px-4 py-2">
                  <AppIcon name="panel" size="sm" class="text-outline" />
                  <span class="tech-text text-[10px] text-on-surface-variant">
                    会话当前路由 {{ activeDetail?.agentName || 'main' }} · {{ activeDetail?.channel || 'webui' }}
                  </span>
                </div>
              </div>

              <article
                v-for="(message, index) in displayMessages"
                :key="`${resolvedSessionKey || 'draft'}-${index}`"
                class="flex flex-col gap-3"
                :class="message.role === 'user' ? 'items-end' : message.role === 'system' ? 'items-center' : 'items-start'"
              >
                <template v-if="message.role === 'system'">
                  <div class="rounded-full bg-surface-container-low px-4 py-2">
                    <span class="tech-text text-[10px] text-on-surface-variant">{{ message.content }}</span>
                  </div>
                </template>

                <template v-else-if="message.role === 'user'">
                  <div class="mr-1 flex items-center gap-2">
                    <span class="tech-text text-[10px] text-outline">{{ formatDateTime(message.timestamp) }}</span>
                    <span class="text-xs font-bold text-on-surface">操作员</span>
                    <span class="flex size-6 items-center justify-center rounded bg-on-surface text-surface">
                      <AppIcon name="sessions" size="sm" />
                    </span>
                  </div>
                  <div class="max-w-[74%] rounded-xl bg-primary p-4 text-sm text-white shadow-lg shadow-primary/10">
                    <p class="whitespace-pre-wrap break-words leading-7">{{ message.content }}</p>
                  </div>
                </template>

                <template v-else>
                  <div class="ml-1 flex items-center gap-2">
                    <span class="flex size-6 items-center justify-center rounded bg-primary-fixed text-on-primary-fixed">
                      <AppIcon name="agents" size="sm" />
                    </span>
                    <span class="text-xs font-bold text-on-surface">{{ activeDetail?.agentName || 'main' }}</span>
                    <span class="tech-text text-[10px] text-outline">{{ formatDateTime(message.timestamp) }}</span>
                  </div>
                  <div class="max-w-[92%] rounded-xl bg-surface-container-lowest p-5 shadow-sm ring-1 ring-outline-variant/8">
                    <p class="whitespace-pre-wrap break-words text-sm leading-7 text-on-surface">{{ message.content }}</p>
                  </div>
                </template>
              </article>
            </template>

            <div v-else class="rounded-[1.4rem] bg-surface-container-low p-8 text-center">
              <p class="cn-section-title text-on-surface">准备开始新的对话</p>
              <p class="cn-body mt-2 text-sm text-on-surface-variant">输入消息后会自动创建新的 WebUI 会话，你可以在这里持续追踪整轮对话内容。</p>
            </div>
          </div>
        </div>

        <footer class="border-t border-outline-variant/10 bg-surface-container-lowest px-4 py-3 md:px-6 md:py-5">
          <div class="mx-auto max-w-4xl space-y-3 md:space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-3 px-1">
              <div class="flex flex-wrap items-center gap-3 text-[10px]">
                <span class="flex items-center gap-1.5 rounded bg-primary-fixed/60 px-2 py-1 font-bold text-on-primary-fixed">
                  <AppIcon name="agents" size="sm" />
                  {{ activeDetail?.agentName || 'main' }}
                </span>
                <span class="tech-text text-outline">Vision: 关闭</span>
                <span class="tech-text text-outline">会话: {{ resolvedSessionKey || '待创建' }}</span>
              </div>
            </div>

            <div class="group relative">
              <div class="absolute -inset-0.5 rounded-2xl bg-gradient-to-r from-primary/20 to-primary-container/20 opacity-0 blur transition duration-300 group-focus-within:opacity-100"></div>
              <div class="relative rounded-2xl border border-outline-variant/10 bg-surface-container-low p-2 transition-all group-focus-within:border-primary/45">
                <textarea
                  v-model="draft"
                  class="min-h-[72px] w-full resize-none bg-transparent px-3 py-3 text-sm text-on-surface outline-none placeholder:text-outline md:min-h-[108px]"
                  placeholder="输入消息..."
                  @keydown="handleDraftKeydown"
                ></textarea>

                <div class="flex items-center justify-end px-2 pb-2">
                  <button
                    class="flex items-center gap-2 rounded-xl bg-gradient-to-br from-primary to-primary-container px-5 py-2 text-sm font-bold text-white shadow-md transition hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60"
                    :disabled="sending || !draft.trim()"
                    type="button"
                    @click="sendMessage"
                  >
                    {{ sending ? '发送中...' : '发送消息' }}
                    <AppIcon name="arrowRight" size="sm" />
                  </button>
                </div>
              </div>
            </div>
          </div>
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
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppIcon from '@/components/AppIcon.vue';
import { useLatestRequestGuard } from '@/composables/useLatestRequestGuard';
import { rpcCall, rpcSubscribe } from '@/lib/rpc';
import { buildTokenQuery, getRouteToken } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import type { Session, SessionDetail, SessionMessage } from '@/lib/types';

const route = useRoute();
const router = useRouter();
const token = getRouteToken(route);

const sessions = ref<Session[]>([]);
const sessionsLoading = ref(false);
const detailLoading = ref(false);
const sending = ref(false);
const deleting = ref(false);
const detailError = ref('');
const draft = ref('');
const sessionFilter = ref('');
const agentFilter = ref<'all' | string>('all');
const activeDetail = ref<SessionDetail | null>(null);
const draftSessionKey = ref('');
const sessionPreviews = ref<Record<string, string>>({});
const sidebarVisible = ref(false);
const detailRequestGuard = useLatestRequestGuard();
let stopSessionsSubscription: (() => void) | null = null;
let stopDetailSubscription: (() => void) | null = null;

const routeSessionKey = computed(() => {
  const raw = route.params.sessionKey;
  return typeof raw === 'string' ? raw : '';
});
const resolvedSessionKey = computed(() => routeSessionKey.value || '');
const activeSessionKey = computed(() => resolvedSessionKey.value || '');
const visibleAgentFilters = computed(() => [...new Set(sessions.value.map((session) => session.agentName || 'main'))].slice(0, 6));
const filteredSessions = computed(() => {
  const query = sessionFilter.value.trim().toLowerCase();
  return [...sessions.value]
    .filter((session) => {
      const matchesAgent = agentFilter.value === 'all' || (session.agentName || 'main') === agentFilter.value;
      const haystack = [session.key, session.channel, session.chatId, session.agentName, sessionPreview(session)]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return matchesAgent && (!query || haystack.includes(query));
    })
    .sort((a, b) => b.messageCount - a.messageCount || a.key.localeCompare(b.key));
});
const displayMessages = computed<SessionMessage[]>(() => activeDetail.value?.messages || []);
const headerTitle = computed(() => {
  if (activeDetail.value) return sessionTitle(activeDetail.value);
  return '新建对话';
});
const contextWidth = computed(() => {
  const messages = activeDetail.value?.messageCount || 0;
  const percent = Math.min(92, Math.max(18, messages * 8));
  return `${percent}%`;
});
const contextLabel = computed(() => {
  const messages = activeDetail.value?.messageCount || 0;
  return `${Math.min(100, messages * 4)}% / 128k`;
});
const draftChannelLabel = computed(() => 'webui');
const draftChatIdLabel = computed(() => draftSessionKey.value || '创建后生成');

function sessionTitle(session: Pick<Session, 'key' | 'chatId' | 'channel'>) {
  return session.chatId || session.key.split(':')[1] || session.channel || '未命名会话';
}

function sessionStateLabel(session: Session) {
  if (activeSessionKey.value === session.key) return '当前';
  if (session.messageCount > 24) return '活跃';
  if (session.messageCount > 0) return '就绪';
  return '空白';
}

function sessionPreview(session: Session) {
  return sessionPreviews.value[session.key] || (session.messageCount > 0 ? '暂无消息预览' : '暂无消息');
}

function createDraftSessionKey() {
  if (!draftSessionKey.value) {
    draftSessionKey.value = `webui:${Date.now().toString(36)}`;
  }
  return draftSessionKey.value;
}

async function loadSessions() {
  sessionsLoading.value = true;
  const sessionsResult = await rpcCall<{ sessions: Session[] }>('sessions.list', token);

  sessions.value = sessionsResult.data?.sessions || [];

  sessionsLoading.value = false;
}

async function loadSessionDetail(key: string) {
  const requestId = detailRequestGuard.start();
  detailLoading.value = true;
  detailError.value = '';
  const result = await rpcCall<SessionDetail>('sessions.getDetail', token, { key });

  if (!detailRequestGuard.isCurrent(requestId)) {
    return;
  }

  if (result.error || !result.data) {
    activeDetail.value = null;
    detailError.value = result.error || '会话读取失败';
    detailLoading.value = false;
    return;
  }

  activeDetail.value = result.data;
  sessionPreviews.value = {
    ...sessionPreviews.value,
    [key]: result.data.messages[result.data.messages.length - 1]?.content || sessionPreviews.value[key] || '暂无消息预览',
  };
  detailLoading.value = false;
}

async function syncRouteSession() {
  if (!routeSessionKey.value) {
    detailRequestGuard.invalidate();
    activeDetail.value = null;
    detailError.value = '';
    detailLoading.value = false;
    return;
  }

  await loadSessionDetail(routeSessionKey.value);
}

function bindSessionsSubscription() {
  stopSessionsSubscription?.();
  stopSessionsSubscription = rpcSubscribe<{ sessions: Session[] }>(
    'sessions.list',
    token,
    undefined,
    (data) => {
      sessions.value = data.sessions;
      if (resolvedSessionKey.value && !data.sessions.some((session) => session.key === resolvedSessionKey.value)) {
        activeDetail.value = null;
        detailError.value = '会话已不存在';
        detailLoading.value = false;
      }
    }
  );
}

function bindDetailSubscription(sessionKey: string) {
  stopDetailSubscription?.();
  stopDetailSubscription = null;

  if (!sessionKey) {
    return;
  }

  stopDetailSubscription = rpcSubscribe<SessionDetail | null>(
    'sessions.detail',
    token,
    { key: sessionKey },
    (data) => {
      if (!data) {
        activeDetail.value = null;
        detailError.value = '会话已不存在';
        detailLoading.value = false;
        return;
      }

      activeDetail.value = data;
      detailError.value = '';
      detailLoading.value = false;
      sessionPreviews.value = {
        ...sessionPreviews.value,
        [sessionKey]: data.messages[data.messages.length - 1]?.content || sessionPreviews.value[sessionKey] || '暂无消息预览'
      };
    },
    {
      onError: (message) => {
        detailError.value = message;
        detailLoading.value = false;
      }
    }
  );
}

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

  const sessionKey = resolvedSessionKey.value || createDraftSessionKey();
  sending.value = true;
  detailError.value = '';

  const result = await rpcCall<{ success: true; response: string }>('chat.createResponse', token, {
    sessionKey,
    message,
    channel: 'webui',
    chatId: sessionKey.split(':')[1],
  });

  sending.value = false;

  if (result.error) {
    detailError.value = result.error;
    return;
  }

  draft.value = '';

  if (!resolvedSessionKey.value) {
    await router.replace({
      path: `/dialogue/${sessionKey}`,
      query: buildTokenQuery(route.query, token),
    });
  }
}

async function deleteCurrentSession() {
  if (!resolvedSessionKey.value) return;
  if (!window.confirm(`确认删除会话 ${resolvedSessionKey.value} 吗？`)) return;

  deleting.value = true;
  const result = await rpcCall<{ success: true }>('sessions.delete', token, { key: resolvedSessionKey.value });
  deleting.value = false;

  if (result.error) {
    detailError.value = result.error;
    return;
  }

  draftSessionKey.value = '';
  await router.replace({
    path: '/dialogue',
    query: buildTokenQuery(route.query, token),
  });
}

function startFreshDialogue() {
  draftSessionKey.value = '';
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
  const target = resolvedSessionKey.value || createDraftSessionKey();
  if (!target || !navigator.clipboard) return;
  await navigator.clipboard.writeText(target).catch(() => undefined);
}

function handleDraftKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    if (!sending.value && draft.value.trim()) {
      sendMessage();
    }
  }
}

watch(() => route.params.sessionKey, () => {
  void syncRouteSession();
  bindDetailSubscription(resolvedSessionKey.value);
});

onMounted(async () => {
  await loadSessions();
  await syncRouteSession();
  bindSessionsSubscription();
  bindDetailSubscription(resolvedSessionKey.value);
});

onBeforeUnmount(() => {
  stopSessionsSubscription?.();
  stopSessionsSubscription = null;
  stopDetailSubscription?.();
  stopDetailSubscription = null;
});
</script>
