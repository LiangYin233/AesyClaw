<template>
  <div class="min-h-screen bg-surface text-on-surface">
    <header class="fixed inset-x-0 top-0 z-50 flex h-14 items-center justify-between border-b border-outline-variant/25 bg-surface-container-lowest/84 px-4 backdrop-blur-xl md:px-6">
      <div class="flex items-center gap-4 md:gap-8">
        <button class="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-outline-variant/16 bg-surface-container-lowest/80 text-on-surface md:hidden" type="button" @click="mobileMenuOpen = !mobileMenuOpen">
          <AppIcon name="menu" />
        </button>
        <div>
          <p class="font-headline text-lg font-black tracking-[0.04em] text-on-surface">AesyClaw</p>
        </div>
      </div>

      <div class="flex items-center gap-2 md:gap-3">
        <button class="inline-flex h-10 items-center gap-2 rounded-xl border border-outline-variant/16 bg-surface-container-lowest/80 px-3 text-xs font-semibold text-on-surface transition-colors hover:bg-surface-container-low" type="button" @click="toggleTheme">
          <AppIcon :name="isDark ? 'sun' : 'moon'" size="sm" />
          <span class="hidden sm:inline">{{ isDark ? '浅色' : '深色' }}</span>
        </button>
      </div>
    </header>

    <div v-if="mobileMenuOpen" class="fixed inset-0 z-40 bg-slate-900/20 backdrop-blur-[2px] md:hidden" @click="mobileMenuOpen = false"></div>

    <aside
      class="fixed left-0 top-14 z-40 flex h-[calc(100vh-3.5rem)] w-72 flex-col overflow-y-auto border-r border-outline-variant/20 bg-surface-container-lowest/72 px-3 py-4 backdrop-blur-xl transition-transform md:w-64"
      :class="mobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'"
    >
      <nav class="flex-1 space-y-1 pt-1">
        <router-link
          v-for="item in navItems"
          :key="item.path"
          :to="{ path: item.path, query: token ? { token } : {} }"
          class="group flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold tracking-[0.02em] transition-colors"
          :class="isNavActive(item) ? 'bg-surface-container-low text-primary' : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'"
          @click="mobileMenuOpen = false"
        >
          <AppIcon :name="item.icon" />
          <span>{{ item.label }}</span>
        </router-link>
      </nav>

      <div class="mt-6 border-t border-outline-variant/18 px-2 pt-4">
        <p class="cn-kicker text-outline">运行摘要</p>
        <div class="mt-4 space-y-3 text-xs">
          <div class="flex items-center justify-between gap-3">
            <span class="text-on-surface-variant">Agent</span>
            <span
              class="rounded-full px-2 py-0.5 font-bold"
              :class="runtimeStatus?.agentRunning ? 'bg-primary-fixed/70 text-on-primary-fixed' : 'bg-error-container/70 text-on-error-container'"
            >
              {{ runtimeStatus?.agentRunning ? '运行中' : '已停止' }}
            </span>
          </div>
          <div class="flex items-center justify-between gap-3">
            <span class="text-on-surface-variant">会话数</span>
            <span class="tech-text font-bold text-on-surface">{{ sessionCountLabel }}</span>
          </div>
          <div class="flex items-center justify-between gap-3">
            <span class="text-on-surface-variant">渠道在线</span>
            <span class="tech-text font-bold text-on-surface">{{ connectedChannelLabel }}</span>
          </div>
          <div class="flex items-center justify-between gap-3">
            <span class="text-on-surface-variant">运行时长</span>
            <span class="tech-text font-bold text-on-surface">{{ uptimeLabel }}</span>
          </div>
        </div>
      </div>
    </aside>

    <main class="min-h-screen pt-14 transition-[margin] md:ml-64">
      <router-view v-slot="{ Component }">
        <transition name="fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import AppIcon from '@/components/AppIcon.vue';
import { rpcCall, rpcSubscribe } from '@/lib/rpc';
import { getRouteToken } from '@/lib/auth';
import { formatNumber, formatUptime } from '@/lib/format';
import type { StatusResponse } from '@/lib/types';

const route = useRoute();
const mobileMenuOpen = ref(false);
const isDark = ref(false);
const runtimeStatus = ref<StatusResponse | null>(null);
let stopStatusSubscription: (() => void) | null = null;

const navItems = [
  { label: '总览', path: '/overview', icon: 'overview', matchPrefixes: ['/overview'] },
  { label: '对话', path: '/dialogue', icon: 'dialogue', matchPrefixes: ['/dialogue'] },
  { label: '会话', path: '/sessions', icon: 'sessions', matchPrefixes: ['/sessions'] },
  { label: '记忆', path: '/memory', icon: 'memory', matchPrefixes: ['/memory'] },
  { label: 'Agent', path: '/agents', icon: 'agents', matchPrefixes: ['/agents'], matchExact: true },
  { label: '执行链', path: '/agents/runtime', icon: 'history', matchPrefixes: ['/agents/runtime'] },
  { label: '技能', path: '/skills', icon: 'skills', matchPrefixes: ['/skills'] },
  { label: '工具', path: '/tools', icon: 'tools', matchPrefixes: ['/tools'] },
  { label: '插件', path: '/plugins', icon: 'plugins', matchPrefixes: ['/plugins'] },
  { label: '定时任务', path: '/cron', icon: 'cron', matchPrefixes: ['/cron'] },
  { label: 'MCP', path: '/mcp', icon: 'mcp', matchPrefixes: ['/mcp'] },
  { label: '观测', path: '/observability/logs', icon: 'observability', matchPrefixes: ['/observability/logs'] },
  { label: '设置', path: '/settings/config', icon: 'settings', matchPrefixes: ['/settings/config'] },
];

const token = computed(() => getRouteToken(route));
const enabledChannelCount = computed(() => Object.values(runtimeStatus.value?.channels || {}).filter((channel) => channel.enabled).length);
const connectedChannelCount = computed(() => Object.values(runtimeStatus.value?.channels || {}).filter((channel) => channel.connected).length);
const sessionCountLabel = computed(() => formatNumber(runtimeStatus.value?.sessions || 0));
const uptimeLabel = computed(() => runtimeStatus.value ? formatUptime(runtimeStatus.value.uptime) : '-');
const connectedChannelLabel = computed(() => `${connectedChannelCount.value}/${enabledChannelCount.value || 0}`);

function isNavActive(item: { path: string; matchPrefixes?: string[]; matchExact?: boolean }) {
  if (item.matchExact) {
    return route.path === item.path;
  }

  const prefixes = item.matchPrefixes?.length ? item.matchPrefixes : [item.path];
  return prefixes.some((prefix) => route.path.startsWith(prefix));
}

async function loadRuntimeSummary() {
  const result = await rpcCall<StatusResponse>('system.getStatus', token.value);
  if (result.data) {
    runtimeStatus.value = result.data;
  }
}

function bindRuntimeSubscription() {
  stopStatusSubscription?.();
  stopStatusSubscription = null;

  if (!token.value) {
    return;
  }

  stopStatusSubscription = rpcSubscribe<StatusResponse>(
    'system.status',
    token.value,
    undefined,
    (data) => {
      runtimeStatus.value = data;
    }
  );
}

function toggleTheme() {
  isDark.value = !isDark.value;
  document.documentElement.classList.toggle('dark', isDark.value);
  window.localStorage.setItem('aesyclaw-console-theme', isDark.value ? 'dark' : 'light');
}

onMounted(() => {
  const stored = window.localStorage.getItem('aesyclaw-console-theme');
  isDark.value = stored === 'dark';
  document.documentElement.classList.toggle('dark', isDark.value);

  void loadRuntimeSummary();
  bindRuntimeSubscription();
});

watch(token, () => {
  void loadRuntimeSummary();
  bindRuntimeSubscription();
});

onBeforeUnmount(() => {
  stopStatusSubscription?.();
  stopStatusSubscription = null;
});
</script>

<style>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
</style>
