<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useAuth } from '../lib/auth';
import {
  HomeIcon,
  RectangleStackIcon,
  ChatBubbleLeftRightIcon,
  FolderIcon,
  CircleStackIcon,
  CommandLineIcon,
  Cog6ToothIcon,
  ClockIcon,
  WrenchIcon,
  DocumentTextIcon,
  ArrowRightStartOnRectangleIcon,
  SunIcon,
  MoonIcon,
  BoltIcon,
} from '@heroicons/vue/24/outline';

const router = useRouter();
const route = useRoute();
const { logout } = useAuth();

const collapsed = ref(false);
const isDark = ref(false);

onMounted(() => {
  isDark.value = document.documentElement.classList.contains('dark');
});

function toggleTheme() {
  isDark.value = !isDark.value;
  if (isDark.value) {
    document.documentElement.classList.add('dark');
    localStorage.setItem('color-scheme', 'dark');
  } else {
    document.documentElement.classList.remove('dark');
    localStorage.setItem('color-scheme', 'light');
  }
}

const iconMap = {
  home: HomeIcon,
  robot: RectangleStackIcon,
  chat: ChatBubbleLeftRightIcon,
  collection: FolderIcon,
  database: CircleStackIcon,
  terminal: CommandLineIcon,
  cog: Cog6ToothIcon,
  clock: ClockIcon,
  wrench: WrenchIcon,
  document: DocumentTextIcon,
};

const navItems = [
  { path: '/', name: 'Overview', icon: 'home' },
  { path: '/agents', name: 'Agents', icon: 'robot' },
  { path: '/dialogue', name: 'Dialogue', icon: 'chat' },
  { path: '/sessions', name: 'Sessions', icon: 'collection' },
  { path: '/memory', name: 'Memory', icon: 'database' },
  { path: '/runtime', name: 'Runtime', icon: 'terminal' },
  { path: '/config', name: 'Config', icon: 'cog' },
  { path: '/cron', name: 'Cron', icon: 'clock' },
  { path: '/tools', name: 'Tools', icon: 'wrench' },
  { path: '/logs', name: 'Logs', icon: 'document' },
];

function isActive(path: string): boolean {
  if (path === '/') {
    return route.path === '/';
  }
  return route.path.startsWith(path);
}

function handleLogout() {
  logout();
  router.push('/login');
}
</script>

<template>
  <div class="flex h-[100dvh] overflow-hidden" style="background: var(--color-surface)">
    <aside
      :class="[
        'flex flex-col transition-all duration-300 ease-out',
        collapsed ? 'w-20' : 'w-64'
      ]"
      style="background: var(--color-surface-container-low)"
    >
      <div
        class="flex items-center justify-between h-16 px-4 border-b transition-colors"
        style="border-color: var(--color-outline-variant)"
      >
        <div class="flex items-center gap-3">
          <div
            class="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-all duration-200"
            style="background: var(--color-primary-container)"
          >
            <BoltIcon class="w-5 h-5" style="color: var(--color-on-primary-container)" />
          </div>
          <Transition name="fade">
            <span
              v-if="!collapsed"
              class="font-bold text-lg whitespace-nowrap"
              style="color: var(--color-on-surface)"
            >
              AesyClaw
            </span>
          </Transition>
        </div>

        <button
          @click="toggleTheme"
          class="p-2 rounded-lg transition-all duration-200 hover:scale-105"
          :style="{
            background: 'var(--color-surface-container-high)',
            color: 'var(--color-on-surface-variant)',
          }"
          :title="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
        >
          <SunIcon v-if="isDark" class="w-5 h-5" />
          <MoonIcon v-else class="w-5 h-5" />
        </button>
      </div>

      <nav class="flex-1 overflow-y-auto py-4 px-3">
        <ul class="space-y-1">
          <li v-for="item in navItems" :key="item.path">
            <router-link
              :to="item.path"
              class="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group"
              :class="[
                isActive(item.path)
                  ? 'font-medium'
                  : 'hover:scale-[1.02]'
              ]"
              :style="{
                background: isActive(item.path)
                  ? 'var(--color-primary-container)'
                  : 'transparent',
                color: isActive(item.path)
                  ? 'var(--color-on-primary-container)'
                  : 'var(--color-on-surface-variant)',
              }"
            >
              <component
                :is="iconMap[item.icon as keyof typeof iconMap]"
                class="w-5 h-5 flex-shrink-0 transition-transform duration-200"
                :class="{ 'group-hover:scale-110': !isActive(item.path) }"
              />
              <Transition name="fade">
                <span v-if="!collapsed" class="text-sm whitespace-nowrap">
                  {{ item.name }}
                </span>
              </Transition>
            </router-link>
          </li>
        </ul>
      </nav>

      <div
        class="p-4 border-t transition-colors"
        style="border-color: var(--color-outline-variant)"
      >
        <button
          @click="handleLogout"
          class="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl transition-all duration-200 hover:scale-[1.02]"
          style="color: var(--color-on-surface-variant)"
        >
          <ArrowRightStartOnRectangleIcon class="w-5 h-5 flex-shrink-0" />
          <Transition name="fade">
            <span v-if="!collapsed" class="text-sm">Logout</span>
          </Transition>
        </button>
      </div>
    </aside>

    <main class="flex-1 overflow-hidden">
      <slot />
    </main>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
