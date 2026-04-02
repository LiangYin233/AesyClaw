<template>
  <div class="p-5 md:p-8">
    <div class="mx-auto max-w-[1600px]">
      <header class="mb-10 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p class="cn-kicker text-outline">Agent Worker</p>
          <h1 class="cn-page-title mt-2 text-on-surface">活跃执行链</h1>
        </div>
      </header>

      <AgentWorkerOverviewPanel
        :snapshot="workerSnapshot"
        :loading="workerLoading"
        :error="workerError"
      />

      <div class="grid grid-cols-1 gap-6">
        <AgentWorkerSessionList
          :sessions="workerSessions"
          :selected-session-key="selectedWorkerSessionKey"
          :aborting-session-key="abortingWorkerSessionKey"
          @select="selectWorkerSession"
          @abort="abortWorkerSession"
        />
        <AgentWorkerDetailPanel
          :session="selectedWorkerSession"
          :aborting-session-key="abortingWorkerSessionKey"
          @abort="abortWorkerSession"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import AgentWorkerDetailPanel from '@/components/agents/AgentWorkerDetailPanel.vue';
import AgentWorkerOverviewPanel from '@/components/agents/AgentWorkerOverviewPanel.vue';
import AgentWorkerSessionList from '@/components/agents/AgentWorkerSessionList.vue';
import { useAgentWorkerRuntime } from '@/composables/useAgentWorkerRuntime';
import { getRouteToken } from '@/lib/auth';
import type { WorkerRuntimeSession } from '@/lib/types';

const route = useRoute();
const token = getRouteToken(route);
const {
  snapshot: workerSnapshot,
  loading: workerLoading,
  error: workerError,
  abortingSessionKey: abortingWorkerSessionKey,
  abortSession: abortWorkerSessionRequest
} = useAgentWorkerRuntime(token);

const selectedWorkerSessionKey = ref('');

const workerSessions = computed(() => workerSnapshot.value?.sessions || []);
const selectedWorkerSession = computed<WorkerRuntimeSession | null>(() => {
  if (!workerSessions.value.length) {
    return null;
  }

  return workerSessions.value.find((session) => session.sessionKey === selectedWorkerSessionKey.value)
    || workerSessions.value[0]
    || null;
});

function selectWorkerSession(sessionKey: string) {
  selectedWorkerSessionKey.value = sessionKey;
}

async function abortWorkerSession(sessionKey: string) {
  await abortWorkerSessionRequest(sessionKey);
}

watch(workerSessions, (sessions) => {
  if (sessions.length === 0) {
    selectedWorkerSessionKey.value = '';
    return;
  }

  const exists = sessions.some((session) => session.sessionKey === selectedWorkerSessionKey.value);
  if (!exists) {
    selectedWorkerSessionKey.value = sessions[0].sessionKey;
  }
});
</script>
