<template>
  <div class="p-5 md:p-8">
    <div class="mx-auto max-w-[1600px]">
      <div class="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p class="cn-kicker text-outline">总览</p>
          <h1 class="cn-page-title mt-2 text-on-surface">系统运行总览</h1>
          <p class="cn-body mt-2 max-w-3xl text-sm text-on-surface-variant">这里会集中展示系统状态、活跃会话、Token 使用和关键风险，方便先快速了解当前整体运行情况。</p>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <button class="inline-flex items-center gap-2 rounded-xl border border-outline-variant/20 bg-surface-container-lowest px-4 py-2.5 text-sm font-semibold text-on-surface shadow-sm transition-colors hover:bg-surface-container-high" type="button" :disabled="refreshing" @click="loadOverview">
            <AppIcon name="refresh" size="sm" />
            刷新
          </button>
        </div>
      </div>

      <div v-if="error" class="mb-8 rounded-2xl border border-error/20 bg-error-container/50 px-5 py-4 text-sm text-on-error-container">
        <div class="flex items-start gap-3">
          <AppIcon name="warning" />
          <div>
            <p class="font-bold">总览数据加载失败</p>
            <p class="mt-1 leading-6">{{ error }}</p>
          </div>
        </div>
      </div>

      <div class="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <article class="rounded-2xl bg-surface-container-lowest p-5 shadow-sm">
          <div class="mb-3 flex items-start justify-between">
            <AppIcon name="panel" class="text-primary" />
            <span class="rounded bg-primary-fixed px-2 py-0.5 text-[10px] font-bold text-on-primary-fixed">{{ status?.agentRunning ? '运行中' : '已停止' }}</span>
          </div>
          <p class="cn-kicker text-outline">当前版本</p>
          <p class="cn-metric mt-1 text-on-surface">{{ status?.version || '-' }}</p>
          <p class="mt-2 text-xs text-on-surface-variant">运行时长：{{ status ? formatUptime(status.uptime) : '-' }}</p>
        </article>

        <article class="rounded-2xl bg-surface-container-lowest p-5 shadow-sm">
          <div class="mb-3 flex items-start justify-between">
            <AppIcon name="sessions" class="text-tertiary" />
            <span class="rounded bg-tertiary-fixed px-2 py-0.5 text-[10px] font-bold text-on-tertiary-fixed">活跃</span>
          </div>
          <p class="cn-kicker text-outline">会话数量</p>
          <p class="cn-metric mt-1 text-on-surface">{{ sessions.length }} 个会话</p>
          <p class="mt-2 text-xs font-medium text-on-surface-variant">
            消息总数 {{ totalMessages }}
          </p>
        </article>

        <article class="rounded-2xl bg-surface-container-lowest p-5 shadow-sm">
          <div class="mb-3 flex items-start justify-between">
            <AppIcon name="agents" class="text-sky-600" />
            <span class="text-[10px] font-bold text-outline">{{ readyAgents }}/{{ agents.length || 0 }} 就绪</span>
          </div>
          <p class="cn-kicker text-outline">Agent 集群</p>
          <p class="cn-metric mt-1 text-on-surface">{{ agents.length }} 个角色</p>
          <p class="mt-2 flex items-center gap-1 text-xs font-medium text-primary">
            <span class="inline-block size-1.5 rounded-full bg-primary"></span>
            {{ missingAgentCount }} 个角色需关注
          </p>
        </article>

        <article class="rounded-2xl bg-surface-container-lowest p-5 shadow-sm">
          <div class="mb-3 flex items-start justify-between">
            <AppIcon name="mcp" :class="disconnectedServers > 0 ? 'text-orange-600' : 'text-emerald-600'" />
            <span
              class="rounded px-2 py-0.5 text-[10px] font-bold"
              :class="disconnectedServers > 0 ? 'bg-error-container text-on-error-container' : 'bg-emerald-100 text-emerald-700'"
            >{{ disconnectedServers > 0 ? `${disconnectedServers} 异常` : '正常' }}</span>
          </div>
          <p class="cn-kicker text-outline">MCP 服务</p>
          <p class="cn-metric mt-1 text-on-surface">{{ servers.length }} 个服务</p>
          <p class="mt-2 flex items-center gap-1 text-xs font-medium" :class="disconnectedServers > 0 ? 'text-error' : 'text-emerald-600'">
            <AppIcon :name="disconnectedServers > 0 ? 'warning' : 'check'" size="sm" :class="disconnectedServers > 0 ? 'text-error' : 'text-emerald-600'" />
            {{ disconnectedServers > 0 ? '存在未连接服务' : '运行正常' }}
          </p>
        </article>

        <article class="rounded-2xl bg-surface-container-lowest p-5 shadow-sm">
          <div class="mb-3 flex items-start justify-between">
            <AppIcon name="observability" class="text-outline" />
          </div>
          <p class="cn-kicker text-outline">Token 使用</p>
          <p class="cn-metric mt-1 text-on-surface">{{ usageStats ? formatNumber(usageStats.totalTokens) : '-' }}</p>
          <p class="mt-2 text-xs text-on-surface-variant">{{ usageStats ? `${formatNumber(usageStats.requestCount)} 次请求` : '暂无统计' }}</p>
        </article>
      </div>

      <section class="mb-8 rounded-2xl bg-surface-container-lowest p-6 shadow-sm">
        <div class="mb-6 flex items-center justify-between gap-3">
          <h3 class="font-headline text-lg font-bold text-on-surface">运行事件流</h3>
          <router-link :to="{ path: '/observability/logs', query: token ? { token } : {} }" class="text-xs font-bold tracking-[0.08em] text-primary hover:underline">查看日志</router-link>
        </div>
        <div class="flex items-center gap-4 overflow-x-auto pb-2">
          <template v-if="recentEvents.length > 0">
            <template v-for="(entry, index) in recentEvents" :key="entry.id">
              <div class="flex shrink-0 items-center gap-3 rounded-2xl border-l-4 bg-surface-container-low px-4 py-3" :class="eventBorderClass(entry.level)">
                <AppIcon :name="eventIcon(entry.level)" class="text-primary" />
                <div>
                  <p class="text-xs font-bold text-on-surface">{{ eventTitle(entry) }}</p>
                  <p class="tech-text mt-1 text-[10px] text-outline">{{ formatDateTime(entry.timestamp) }} · {{ levelLabel(entry.level) }}</p>
                </div>
              </div>
              <div v-if="index < recentEvents.length - 1" class="h-px w-8 shrink-0 bg-outline-variant/30"></div>
            </template>
          </template>
          <div v-else class="rounded-2xl bg-surface-container-low px-4 py-3 text-sm text-on-surface-variant">暂无可展示的运行事件。</div>
        </div>
      </section>

      <div class="grid grid-cols-1 gap-8 xl:grid-cols-3">
        <div class="space-y-4 xl:col-span-2">
          <div class="flex items-center justify-between">
            <h3 class="font-headline text-lg font-bold text-on-surface">最近活跃会话</h3>
            <router-link :to="{ path: '/sessions', query: token ? { token } : {} }" class="text-xs font-bold tracking-[0.08em] text-primary hover:underline">查看全部</router-link>
          </div>
          <div class="overflow-hidden rounded-2xl bg-surface-container-lowest shadow-sm">
            <table class="w-full border-collapse text-left text-sm">
              <thead>
                <tr class="border-b border-outline-variant/10 bg-surface-container-low">
                  <th class="px-5 py-4 text-left text-[11px] font-bold tracking-[0.08em] text-outline">会话</th>
                  <th class="px-5 py-4 text-left text-[11px] font-bold tracking-[0.08em] text-outline">Agent</th>
                  <th class="px-5 py-4 text-left text-[11px] font-bold tracking-[0.08em] text-outline">消息数</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-outline-variant/10">
                <tr v-for="session in recentSessions" :key="session.key" class="cursor-pointer transition-colors hover:bg-surface-container-low/60" @click="openSession(session.key)">
                  <td class="px-5 py-4">
                    <div class="flex items-center gap-3">
                      <span class="inline-block size-2 rounded-full" :class="session.messageCount > 0 ? 'bg-primary' : 'bg-outline-variant'"></span>
                      <div>
                        <p class="font-semibold text-on-surface">{{ session.chatId || session.key }}</p>
                        <p class="mt-1 text-[11px] text-outline">渠道：{{ session.channel || '未知' }}</p>
                      </div>
                    </div>
                  </td>
                  <td class="px-5 py-4">
                    <span class="rounded-lg bg-surface-container-high px-2 py-1 text-[11px] font-mono text-on-surface">{{ session.agentName || 'main' }}</span>
                  </td>
                  <td class="px-5 py-4 font-mono text-xs text-on-surface-variant">{{ formatNumber(session.messageCount) }}</td>
                </tr>
                <tr v-if="recentSessions.length === 0">
                  <td colspan="3" class="px-5 py-8 text-center text-sm text-on-surface-variant">还没有可展示的会话记录。</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="space-y-4">
          <h3 class="font-headline text-lg font-bold text-on-surface">关键关注项</h3>
          <div class="space-y-3 rounded-2xl bg-surface-container-lowest p-4 shadow-sm">
            <div v-for="alert in criticalAlerts" :key="alert.title" class="rounded-xl border-l-4 px-4 py-4" :class="alert.tone">
              <div class="flex items-start gap-4">
                <AppIcon :name="alert.icon" class="mt-0.5" />
                <div class="min-w-0 flex-1">
                  <p class="text-xs font-bold text-on-background">{{ alert.title }}</p>
                  <p class="mt-1 text-[11px] leading-5 text-on-surface-variant">{{ alert.description }}</p>
                  <button v-if="alert.action" class="mt-3 text-[11px] font-bold tracking-[0.08em] text-primary hover:underline" type="button" @click="goTo(alert.action.path)">
                    {{ alert.action.label }}
                  </button>
                </div>
              </div>
            </div>
            <div v-if="criticalAlerts.length === 0" class="rounded-xl bg-surface-container-low px-4 py-4 text-sm text-on-surface-variant">当前没有高优先级风险项，系统运行平稳。</div>
          </div>

          <div class="relative overflow-hidden rounded-2xl bg-primary p-6 text-white shadow-xl shadow-primary/20">
            <div class="absolute -bottom-5 -right-5 opacity-10">
              <AppIcon name="rocket" size="xl" class="size-28" />
            </div>
            <p class="cn-kicker opacity-70">快速入口</p>
            <h4 class="mt-2 font-headline text-xl font-extrabold">从主角色开始</h4>
            <p class="mt-2 text-sm leading-6 opacity-80">配置模型与系统提示词，再绑定所需技能与工具。</p>
            <router-link :to="{ path: '/agents', query: token ? { token } : {} }" class="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-bold text-primary transition hover:bg-white/90">
              前往 Agent 页
              <AppIcon name="arrowRight" size="sm" />
            </router-link>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppIcon from '@/components/AppIcon.vue';
import { apiGet } from '@/lib/api';
import { getRouteToken } from '@/lib/auth';
import { abbreviateText, formatDateTime, formatNumber, formatUptime } from '@/lib/format';
import type { AgentRole, MCPServerInfo, ObservabilityLogEntry, Session, StatusResponse, TokenUsageStats } from '@/lib/types';

const route = useRoute();
const router = useRouter();
const token = getRouteToken(route);

const status = ref<StatusResponse | null>(null);
const usageStats = ref<TokenUsageStats | null>(null);
const sessions = ref<Session[]>([]);
const agents = ref<AgentRole[]>([]);
const servers = ref<MCPServerInfo[]>([]);
const logs = ref<ObservabilityLogEntry[]>([]);
const refreshing = ref(false);
const error = ref('');

const recentSessions = computed(() => [...sessions.value].sort((a, b) => b.messageCount - a.messageCount).slice(0, 6));
const totalMessages = computed(() => sessions.value.reduce((sum, s) => sum + s.messageCount, 0));
const missingAgentCount = computed(() => agents.value.filter((agent) => agent.missingSkills.length > 0 || agent.missingTools.length > 0).length);
const readyAgents = computed(() => agents.value.length - missingAgentCount.value);
const disconnectedServers = computed(() => servers.value.filter((server) => server.status !== 'connected').length);
const importantScopes = ['bootstrap', 'mcp', 'mcpruntime', 'channelmanager', 'channelruntime', 'pluginmanager', 'pluginruntimefactory', 'cron', 'cronservice'];
const recentEvents = computed(() => logs.value
  .filter((entry) => {
    if (entry.level === 'warn' || entry.level === 'error') return true;
    if (entry.level === 'info') {
      const scope = entry.scope?.toLowerCase() || '';
      return importantScopes.some((s) => scope.includes(s));
    }
    return false;
  })
  .slice(0, 4)
);

const criticalAlerts = computed(() => {
  const alerts: Array<{ title: string; description: string; icon: string; tone: string; action?: { label: string; path: string } }> = [];

  const missingAgent = agents.value.find((agent) => agent.missingSkills.length > 0 || agent.missingTools.length > 0);
  if (missingAgent) {
    alerts.push({
      title: `Agent "${missingAgent.name}" 缺少必要的技能或工具`,
      description: `缺失技能 ${missingAgent.missingSkills.join('、') || '无'}；缺失工具 ${missingAgent.missingTools.join('、') || '无'}。建议先补齐再投入运行。`,
      icon: 'warning',
      tone: 'border-error bg-error-container/25 text-error',
      action: { label: '前往处理', path: '/agents' },
    });
  }

  const failedServer = servers.value.find((server) => server.status !== 'connected');
  if (failedServer) {
    alerts.push({
      title: `MCP 服务 "${failedServer.name}" 连接失败了`,
      description: failedServer.error || '服务目前未连接，依赖它的工具可能无法使用。',
      icon: 'mcp',
      tone: 'border-tertiary bg-tertiary-fixed/20 text-tertiary',
      action: { label: '查看 MCP', path: '/mcp' },
    });
  }

  const errorLog = logs.value.find((entry) => entry.level === 'error');
  if (errorLog) {
    alerts.push({
      title: '近期存在错误日志',
      description: abbreviateText(errorLog.message, 88),
      icon: 'observability',
      tone: 'border-outline bg-surface-container-low text-on-surface',
      action: { label: '查看观测', path: '/observability/logs' },
    });
  }

  return alerts.slice(0, 3);
});

function levelLabel(level: ObservabilityLogEntry['level']) {
  const map = { debug: '调试', info: '信息', warn: '警告', error: '错误' };
  return map[level] || level;
}

function eventBorderClass(level: ObservabilityLogEntry['level']) {
  if (level === 'error') return 'border-error';
  if (level === 'warn') return 'border-tertiary';
  return 'border-primary';
}

function eventIcon(level: ObservabilityLogEntry['level']) {
  if (level === 'error' || level === 'warn') return 'warning';
  return 'refresh';
}

function eventTitle(entry: ObservabilityLogEntry) {
  return entry.scope ? `${entry.scope} · ${abbreviateText(entry.message, 36)}` : abbreviateText(entry.message, 42);
}

async function loadOverview() {
  refreshing.value = true;
  error.value = '';

  const [statusResult, usageResult, sessionsResult, agentsResult, serversResult, logsResult] = await Promise.all([
    apiGet<StatusResponse>('/api/status', token),
    apiGet<TokenUsageStats>('/api/observability/usage', token),
    apiGet<{ sessions: Session[] }>('/api/sessions', token),
    apiGet<{ agents: AgentRole[] }>('/api/agents', token),
    apiGet<{ servers: MCPServerInfo[] }>('/api/mcp/servers', token),
    apiGet<{ entries: ObservabilityLogEntry[] }>('/api/observability/logging/entries', token, { limit: 12 }),
  ]);

  if (statusResult.error) {
    error.value = statusResult.error;
  }

  status.value = statusResult.data;
  usageStats.value = usageResult.data;
  sessions.value = sessionsResult.data?.sessions || [];
  agents.value = agentsResult.data?.agents || [];
  servers.value = serversResult.data?.servers || [];
  logs.value = logsResult.data?.entries || [];
  refreshing.value = false;
}

function openSession(sessionKey: string) {
  router.push({ path: `/dialogue/${sessionKey}`, query: token ? { token } : {} });
}

function goTo(path: string) {
  router.push({ path, query: token ? { token } : {} });
}

onMounted(() => {
  void loadOverview();
});
</script>
