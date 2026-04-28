<template>
  <div class="layout">
    <aside class="sidebar">
      <div class="sidebar-brand">
        <span class="brand-icon">🤖</span>
        <span class="brand-text">AesyClaw</span>
      </div>
      <nav class="sidebar-nav">
        <RouterLink
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          class="nav-item"
          :class="{ active: $route.path === item.path }"
        >
          <span class="nav-icon">{{ item.icon }}</span>
          <span class="nav-label">{{ item.label }}</span>
        </RouterLink>
      </nav>
    </aside>
    <div class="main">
      <header class="topbar">
        <h1 class="page-title">{{ pageTitle }}</h1>
        <button class="btn btn-ghost" @click="handleLogout">Logout</button>
      </header>
      <main class="content">
        <RouterView />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuth } from '@/composables/useAuth';

const route = useRoute();
const router = useRouter();
const { logout } = useAuth();

const navItems = [
  { path: '/', label: 'Dashboard', icon: '📊' },
  { path: '/sessions', label: 'Sessions', icon: '💬' },
  { path: '/config', label: 'Config', icon: '⚙️' },
  { path: '/cron', label: 'Cron Jobs', icon: '⏰' },
  { path: '/roles', label: 'Roles', icon: '🎭' },
];

const pageTitle = computed(() => {
  const current = navItems.find((i) => i.path === route.path);
  return current?.label ?? 'AesyClaw Admin';
});

function handleLogout() {
  logout();
  router.push('/login');
}
</script>
