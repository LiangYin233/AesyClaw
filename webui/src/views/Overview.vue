<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import AppLayout from '../components/AppLayout.vue';
import SkeletonLoader from '../components/SkeletonLoader.vue';
import EmptyState from '../components/EmptyState.vue';
import {
  agentsApi,
  sessionsApi,
  cronApi,
} from '../lib/api';
import {
  RectangleStackIcon,
  FolderIcon,
  ClockIcon,
  ChatBubbleLeftRightIcon,
  ArrowRightIcon,
} from '@heroicons/vue/24/outline';

const agents = ref<{
  chatId: string;
  memoryStats: { totalMessages: number };
  tokenBudget: { currentTokens: number; maxTokens: number };
}[]>([]);
const sessions = ref<{ chatId: string; title: string }[]>([]);
const cronJobs = ref<{ id: string; enabled: boolean }[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

const totalMessages = computed(() =>
  agents.value.reduce((sum, a) => sum + (a.memoryStats?.totalMessages || 0), 0)
);

async function loadData() {
  loading.value = true;
  error.value = null;

  try {
    const [agentsRes, sessionsRes, cronRes] = await Promise.all([
      agentsApi.getStats(),
      sessionsApi.list(),
      cronApi.list(),
    ]);

    agents.value = agentsRes.agents || [];
    sessions.value = sessionsRes.sessions || [];
    cronJobs.value = cronRes.jobs || [];
  } catch (err: any) {
    error.value = err.message || 'Failed to load data';
  } finally {
    loading.value = false;
  }
}

onMounted(loadData);
</script>

<template>
  <AppLayout>
    <div class="h-full overflow-y-auto">
      <div class="max-w-7xl mx-auto p-6">
        <h1 class="text-2xl font-bold tracking-tight mb-6" style="color: var(--color-on-surface)">
          System Overview
        </h1>

        <template v-if="loading">
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <div
              v-for="i in 4"
              :key="i"
              class="rounded-2xl p-6 border"
              style="
                background: var(--color-surface-container-low);
                border-color: var(--color-outline-variant);
              "
            >
              <div class="flex items-center justify-between">
                <div class="space-y-2">
                  <SkeletonLoader variant="text" width="80px" />
                  <SkeletonLoader variant="text" width="60px" height="2rem" />
                </div>
                <SkeletonLoader variant="card" width="48px" height="48px" />
              </div>
            </div>
          </div>
          <div
            class="rounded-2xl border overflow-hidden"
            style="
              background: var(--color-surface-container-low);
              border-color: var(--color-outline-variant);
            "
          >
            <div class="px-6 py-4 border-b" style="border-color: var(--color-outline-variant)">
              <SkeletonLoader variant="text" width="120px" />
            </div>
            <div class="divide-y" style="--tw-divide-opacity: 0.1">
              <div v-for="i in 3" :key="i" class="px-6 py-4 flex items-center justify-between">
                <div class="space-y-2">
                  <SkeletonLoader variant="text" width="160px" />
                  <SkeletonLoader variant="text" width="200px" />
                </div>
                <SkeletonLoader variant="button" />
              </div>
            </div>
          </div>
        </template>

        <template v-else-if="error">
          <EmptyState
            variant="error"
            title="Failed to load data"
            :description="error"
            action-text="Retry"
            @action="loadData"
          />
        </template>

        <template v-else>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <StatCard
              label="Active Agents"
              :value="agents.length"
              :icon="RectangleStackIcon"
              icon-color="text-blue-400"
              icon-bg="bg-blue-500/10"
            />
            <StatCard
              label="Total Sessions"
              :value="sessions.length"
              :icon="FolderIcon"
              icon-color="text-green-400"
              icon-bg="bg-green-500/10"
            />
            <StatCard
              label="Cron Jobs"
              :value="cronJobs.length"
              :icon="ClockIcon"
              icon-color="text-purple-400"
              icon-bg="bg-purple-500/10"
            />
            <StatCard
              label="Total Messages"
              :value="totalMessages"
              :icon="ChatBubbleLeftRightIcon"
              icon-color="text-yellow-400"
              icon-bg="bg-yellow-500/10"
            />
          </div>

          <div
            class="rounded-2xl border overflow-hidden"
            style="
              background: var(--color-surface-container-low);
              border-color: var(--color-outline-variant);
            "
          >
            <div
              class="px-6 py-4 border-b flex items-center justify-between"
              style="border-color: var(--color-outline-variant)"
            >
              <h2 class="text-lg font-semibold" style="color: var(--color-on-surface)">
                Recent Sessions
              </h2>
              <span class="text-sm" style="color: var(--color-outline)">
                {{ sessions.length }} total
              </span>
            </div>

            <template v-if="sessions.length === 0">
              <EmptyState
                variant="empty"
                title="No sessions yet"
                description="Start a new dialogue to create your first session."
              />
            </template>

            <div v-else class="divide-y" style="--tw-divide-opacity: 0.1">
              <div
                v-for="(session, index) in sessions.slice(0, 5)"
                :key="session.chatId"
                class="px-6 py-4 flex items-center justify-between group transition-all duration-200 hover:scale-[1.01]"
                :style="{
                  animationDelay: `${index * 50}ms`,
                }"
              >
                <div>
                  <p class="font-medium" style="color: var(--color-on-surface)">
                    {{ session.title || 'Untitled Session' }}
                  </p>
                  <p class="text-sm" style="color: var(--color-outline)">
                    {{ session.chatId }}
                  </p>
                </div>
                <router-link
                  :to="`/dialogue/${session.chatId}`"
                  class="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 group-hover:scale-[1.02]"
                  style="
                    background: var(--color-primary-container);
                    color: var(--color-on-primary-container);
                  "
                >
                  Open
                  <ArrowRightIcon class="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                </router-link>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>
  </AppLayout>
</template>

<script lang="ts">
import { h, defineComponent } from 'vue';

const StatCard = defineComponent({
  props: {
    label: { type: String, required: true },
    value: { type: [Number, String], required: true },
    icon: { type: Object, required: true },
    iconColor: { type: String, default: 'text-blue-400' },
    iconBg: { type: String, default: 'bg-blue-500/10' },
  },
  setup(props) {
    return () =>
      h(
        'div',
        {
          class: 'rounded-2xl p-6 border transition-all duration-200 hover:scale-[1.02] cursor-default',
          style: `
            background: var(--color-surface-container-low);
            border-color: var(--color-outline-variant);
          `,
        },
        [
          h('div', { class: 'flex items-center justify-between' }, [
            h('div', {}, [
              h('p', {
                class: 'text-sm mb-1',
                style: 'color: var(--color-outline)',
              }, props.label),
              h('p', {
                class: 'text-3xl font-bold tracking-tight',
                style: 'color: var(--color-on-surface)',
              }, props.value),
            ]),
            h('div', {
              class: `w-12 h-12 rounded-xl flex items-center justify-center ${props.iconBg}`,
            }, [
              h(props.icon, {
                class: `w-6 h-6 ${props.iconColor}`,
              }),
            ]),
          ]),
        ]
      );
  },
});

export { StatCard };
</script>
