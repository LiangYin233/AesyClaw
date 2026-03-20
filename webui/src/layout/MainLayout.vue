<template>
  <div class="min-h-screen bg-surface text-on-surface">
    <header class="fixed inset-x-0 top-0 z-50 flex h-14 items-center justify-between border-b border-outline-variant/40 bg-surface-container-lowest/88 px-4 backdrop-blur-xl md:px-6">
      <div class="flex items-center gap-4 md:gap-8">
        <button class="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-outline-variant/20 bg-surface-container-low text-on-surface md:hidden" type="button" @click="mobileMenuOpen = !mobileMenuOpen">
          <AppIcon name="menu" />
        </button>
        <div class="flex items-center gap-3">
          <div class="flex size-9 items-center justify-center rounded-xl bg-primary text-on-primary shadow-lg shadow-primary/20">
            <AppIcon name="deployed" />
          </div>
          <div>
            <p class="text-[11px] font-bold tracking-[0.16em] text-outline">AesyClaw</p>
            <h1 class="text-sm font-bold tracking-[0.02em] text-on-surface">中文控制台</h1>
          </div>
        </div>
        <label class="hidden items-center gap-2 rounded-xl border border-outline-variant/20 bg-surface-container-low px-3 py-2 md:flex">
          <AppIcon name="search" size="sm" class="text-outline" />
          <input
            type="text"
            class="w-64 bg-transparent text-sm text-on-surface outline-none placeholder:text-outline"
            placeholder="全局检索（即将接入）"
            readonly
          />
        </label>
      </div>

      <div class="flex items-center gap-2 md:gap-3">
        <button class="inline-flex h-10 w-10 items-center justify-center rounded-xl text-outline transition-colors hover:bg-surface-container-low hover:text-on-surface" type="button">
          <AppIcon name="panel" />
        </button>
        <button class="inline-flex h-10 w-10 items-center justify-center rounded-xl text-outline transition-colors hover:bg-surface-container-low hover:text-on-surface" type="button">
          <AppIcon name="history" />
        </button>
        <button class="inline-flex h-10 items-center gap-2 rounded-xl border border-outline-variant/20 bg-surface-container-low px-3 text-xs font-semibold text-on-surface transition-colors hover:bg-surface-container" type="button" @click="toggleTheme">
          <AppIcon :name="isDark ? 'sun' : 'moon'" size="sm" />
          <span class="hidden sm:inline">{{ isDark ? '浅色' : '深色' }}</span>
        </button>
      </div>
    </header>

    <div v-if="mobileMenuOpen" class="fixed inset-0 z-40 bg-slate-900/20 backdrop-blur-[2px] md:hidden" @click="mobileMenuOpen = false"></div>

    <aside
      class="fixed left-0 top-14 z-40 flex h-[calc(100vh-3.5rem)] w-72 flex-col overflow-y-auto border-r border-outline-variant/30 bg-surface-container-low px-4 py-4 transition-transform md:w-64"
      :class="mobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'"
    >
      <div class="mb-6 rounded-2xl border border-primary/10 bg-gradient-to-br from-primary-fixed to-surface-container-lowest p-4">
        <div class="flex items-center gap-3">
          <div class="flex size-11 items-center justify-center rounded-2xl bg-primary text-on-primary shadow-lg shadow-primary/15">
            <AppIcon name="robot" />
          </div>
          <div>
            <h2 class="text-sm font-bold tracking-[0.02em] text-on-surface">运行中控</h2>
            <p class="mt-1 text-[11px] tracking-[0.08em] text-outline">当前页面 {{ currentLabel }}</p>
          </div>
        </div>
      </div>

      <nav class="flex-1 space-y-1">
        <router-link
          v-for="item in navItems"
          :key="item.path"
          :to="{ path: item.path, query: token ? { token } : {} }"
          class="group flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold tracking-[0.02em] transition-all"
          :class="$route.path.startsWith(item.path) ? 'translate-x-1 bg-primary-fixed text-primary shadow-sm shadow-primary/10' : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'"
          @click="mobileMenuOpen = false"
        >
          <AppIcon :name="item.icon" />
          <span>{{ item.label }}</span>
        </router-link>
      </nav>

      <div class="mt-6 rounded-2xl bg-surface-container-high p-4 shadow-sm">
        <p class="cn-kicker text-outline">运行摘要</p>
        <div class="mt-3 h-2 overflow-hidden rounded-full bg-outline-variant/25">
          <div class="h-full rounded-full bg-primary transition-all" :style="{ width: usageWidth }"></div>
        </div>
        <p class="tech-text mt-3 text-[11px] text-on-surface-variant">{{ usageLabel }}</p>
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
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import AppIcon from '@/components/AppIcon.vue';
import { getRouteToken } from '@/lib/auth';

const route = useRoute();
const mobileMenuOpen = ref(false);
const isDark = ref(false);

const navItems = [
  { label: '总览', path: '/overview', icon: 'overview' },
  { label: '对话', path: '/dialogue', icon: 'dialogue' },
  { label: '会话', path: '/sessions', icon: 'sessions' },
  { label: '记忆', path: '/memory', icon: 'memory' },
  { label: 'Agent', path: '/agents', icon: 'agents' },
  { label: '技能', path: '/skills', icon: 'skills' },
  { label: '工具', path: '/tools', icon: 'tools' },
  { label: '插件', path: '/plugins', icon: 'plugins' },
  { label: '定时任务', path: '/cron', icon: 'cron' },
  { label: 'MCP', path: '/mcp', icon: 'mcp' },
  { label: '观测', path: '/observability/logs', icon: 'observability' },
  { label: '设置', path: '/settings/config', icon: 'settings' },
];

const token = computed(() => getRouteToken(route));
const currentLabel = computed(() => navItems.find((item) => route.path.startsWith(item.path))?.label ?? '控制台');
const usageWidth = computed(() => {
  const buckets: Record<string, string> = {
    '/overview': '72%',
    '/dialogue': '64%',
    '/agents': '58%',
    '/sessions': '69%',
    '/observability/logs': '81%',
  };
  return buckets[route.path] ?? '46%';
});
const usageLabel = computed(() => {
  if (route.path.startsWith('/overview')) return '系统总览已激活';
  if (route.path.startsWith('/dialogue')) return '对话编排工作台已激活';
  if (route.path.startsWith('/agents')) return 'Agent 编排页已激活';
  if (route.path.startsWith('/sessions')) return '会话资源面板已激活';
  if (route.path.startsWith('/observability')) return '观测面板已激活';
  return `${currentLabel.value} 模块已切入新版壳层`;
});

function toggleTheme() {
  isDark.value = !isDark.value;
  document.documentElement.classList.toggle('dark', isDark.value);
  window.localStorage.setItem('aesyclaw-console-theme', isDark.value ? 'dark' : 'light');
}

onMounted(() => {
  const stored = window.localStorage.getItem('aesyclaw-console-theme');
  isDark.value = stored === 'dark';
  document.documentElement.classList.toggle('dark', isDark.value);
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
