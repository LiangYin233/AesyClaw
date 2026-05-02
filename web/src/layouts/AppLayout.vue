<template>
  <div class="flex flex-col h-screen overflow-hidden">
    <header class="h-topbar bg-[#FDFBF8] border-b border-[var(--color-border)] flex items-center justify-between px-6 shrink-0 z-10">
      <div class="flex items-center gap-2">
        <button class="lg:hidden flex items-center justify-center w-8 h-8 rounded-sm border border-[var(--color-border)] bg-transparent text-mid-gray cursor-pointer transition-all duration-[0.15s] ease hover:bg-[#FAF7F4] hover:text-dark mr-1" aria-label="Open navigation" :aria-expanded="drawerOpen" @click="drawerOpen = true">
          <Bars3Icon class="w-[18px] h-[18px]" />
        </button>
        <img src="/groupLogo.svg" alt="AesyClaw" class="h-7 w-auto block" />
        <span class="font-heading text-[0.7rem] font-medium text-mid-gray bg-[#FAF7F4] px-[0.5rem] py-[0.15rem] rounded border border-[var(--color-border)]">v{{ appVersion }}</span>
      </div>
      <div class="flex items-center gap-2">
        <button class="flex items-center justify-center w-8 h-8 rounded-sm border border-[var(--color-border)] bg-transparent text-mid-gray cursor-pointer transition-all duration-[0.15s] ease hover:bg-[#FAF7F4] hover:text-dark">
          <SunIcon class="w-[18px] h-[18px]" />
        </button>
        <button class="inline-flex items-center gap-1.5 px-3 py-[0.4rem] border border-[var(--color-border)] rounded-sm bg-transparent text-mid-gray font-heading text-xs font-medium cursor-pointer transition-all duration-[0.15s] ease hover:bg-[#FAF7F4] hover:text-dark hover:border-mid-gray" @click="handleLogout">
          <ArrowLeftEndOnRectangleIcon class="w-4 h-4" />
          <span>Logout</span>
        </button>
      </div>
    </header>

    <div class="flex flex-1 overflow-hidden">
      <!-- Desktop sidebar -->
      <aside class="hidden lg:flex w-sidebar bg-[#FAF7F4] flex-col shrink-0 border-r border-[var(--color-border)]">
        <nav class="flex flex-col p-3 gap-1 flex-1">
          <RouterLink
            v-for="item in navItems"
            :key="item.path"
            :to="item.path"
            class="flex items-center gap-3 px-4 py-[0.7rem] rounded-sm text-mid-gray no-underline font-heading text-sm font-medium transition-all duration-[0.15s] ease relative hover:text-dark hover:bg-[rgba(20,20,19,0.04)]"
            :class="{ '!text-dark !bg-[#F7F0EA] before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:w-[3px] before:h-5 before:bg-primary before:rounded-r-[3px]': $route.path === item.path }"
          >
            <component :is="item.icon" class="w-5 h-5 shrink-0" />
            <span>{{ item.label }}</span>
          </RouterLink>
        </nav>
      </aside>

      <!-- Mobile drawer -->
      <Transition name="drawer">
        <div v-if="drawerOpen" class="fixed left-0 right-0 bottom-0 top-topbar z-50 lg:hidden">
          <div class="absolute inset-0 bg-[rgba(20,20,19,0.25)] backdrop-blur-sm" @click="drawerOpen = false"></div>
          <aside class="drawer absolute left-0 top-0 bottom-0 w-sidebar bg-[#FAF7F4] flex flex-col shrink-0 border-r border-[var(--color-border)] shadow-lg" aria-label="Main navigation">
            <nav class="flex flex-col p-3 gap-1 flex-1">
              <RouterLink
                v-for="item in navItems"
                :key="item.path"
                :to="item.path"
                class="flex items-center gap-3 px-4 py-[0.7rem] rounded-sm text-mid-gray no-underline font-heading text-sm font-medium transition-all duration-[0.15s] ease relative hover:text-dark hover:bg-[rgba(20,20,19,0.04)]"
                :class="{ '!text-dark !bg-[#F7F0EA] before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:w-[3px] before:h-5 before:bg-primary before:rounded-r-[3px]': $route.path === item.path }"
                @click="drawerOpen = false"
              >
                <component :is="item.icon" class="w-5 h-5 shrink-0" />
                <span>{{ item.label }}</span>
              </RouterLink>
            </nav>
          </aside>
        </div>
      </Transition>

      <main class="flex-1 px-4 pt-4 lg:pl-7 lg:pr-8 lg:pt-7 overflow-auto bg-[#FAF7F4]">
        <RouterView />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuth } from '@/composables/useAuth';
import { useAppInfo } from '@/composables/useAppInfo';
import {
  HomeIcon,
  UsersIcon,
  Cog6ToothIcon,
  ChartBarSquareIcon,
  WrenchIcon,
  ClockIcon,
  ShieldCheckIcon,
  ChartBarIcon,
  DocumentTextIcon,
  WrenchScrewdriverIcon,
  LightBulbIcon,
  SunIcon,
  ArrowLeftEndOnRectangleIcon,
  Bars3Icon,
} from '@heroicons/vue/24/outline';

const drawerOpen = ref(false);

const route = useRoute();
const router = useRouter();
const { logout } = useAuth();
const { appVersion, fetchVersion } = useAppInfo();

onMounted(fetchVersion);

const navItems = [
  { path: '/', label: 'Dashboard', icon: HomeIcon },
  { path: '/sessions', label: 'Sessions', icon: UsersIcon },
  { path: '/usage', label: 'Usage', icon: ChartBarIcon },
  { path: '/logs', label: 'Logs', icon: DocumentTextIcon },
  { path: '/roles', label: 'Roles', icon: ShieldCheckIcon },
  { path: '/tools', label: 'Tools', icon: WrenchScrewdriverIcon },
  { path: '/skills', label: 'Skills', icon: LightBulbIcon },
  { path: '/cron', label: 'Cron Jobs', icon: ClockIcon },
  { path: '/channels', label: 'Channels', icon: ChartBarSquareIcon },
  { path: '/plugins', label: 'Plugins', icon: WrenchIcon },
  { path: '/config', label: 'Config', icon: Cog6ToothIcon },
];

function handleLogout() {
  logout();
  router.push('/login');
}
</script>
