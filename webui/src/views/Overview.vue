<template>
  <div class="p-5 md:p-8">
    <div class="mx-auto max-w-[1600px]">
      <div class="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p class="cn-kicker text-outline">总览</p>
          <h1 class="cn-page-title mt-2 text-on-surface">系统运行总览</h1>
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

      <section class="workspace-shell mb-8 rounded-[1.75rem] px-6 py-5">
        <div class="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
          <div class="workspace-kpi">
            <span class="workspace-kpi-label">运行状态</span>
            <div class="flex items-center gap-3">
              <span class="workspace-kpi-value">{{ status?.agentRunning ? '运行中' : '已停止' }}</span>
              <span
                class="rounded-full px-2 py-0.5 text-[10px] font-bold"
                :class="status?.agentRunning ? 'bg-primary-fixed/75 text-on-primary-fixed' : 'bg-error-container/80 text-on-error-container'"
              >
                {{ status?.version || '-' }}
              </span>
            </div>
            <span class="workspace-kpi-note">运行时长 {{ status ? formatUptime(status.uptime) : '-' }}</span>
          </div>
          <div class="workspace-kpi">
            <span class="workspace-kpi-label">会话负载</span>
            <span class="workspace-kpi-value">{{ sessions.length }} 个会话</span>
            <span class="workspace-kpi-note">累计消息 {{ formatNumber(totalMessages) }}</span>
          </div>
          <div class="workspace-kpi">
            <span class="workspace-kpi-label">角色准备度</span>
            <span class="workspace-kpi-value">{{ readyAgents }}/{{ agents.length || 0 }} 就绪</span>
            <span class="workspace-kpi-note">{{ missingAgentCount }} 个角色需要补齐技能或工具</span>
          </div>
          <div class="workspace-kpi">
            <span class="workspace-kpi-label">系统依赖</span>
            <span class="workspace-kpi-value">{{ servers.length }} 个 MCP 服务</span>
            <span class="workspace-kpi-note">{{ disconnectedServers > 0 ? `${disconnectedServers} 个服务未连接` : '所有服务连接正常' }}</span>
          </div>
        </div>
      </section>

      <div class="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.4fr)_22rem]">
        <section class="workspace-shell overflow-hidden rounded-[1.75rem]">
          <div class="border-b workspace-divider px-6 py-5">
            <div class="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p class="cn-section-title text-on-surface">运行工作区</p>
                <p class="mt-1 text-sm text-on-surface-variant">把需要优先处理的风险、关键事件和最新会话放在同一视图里。</p>
              </div>
              <router-link :to="{ path: '/observability/logs', query: token ? { token } : {} }" class="text-xs font-bold tracking-[0.08em] text-primary hover:underline">打开日志流</router-link>
            </div>
          </div>

          <div class="grid grid-cols-1 xl:grid-cols-[0.9fr_1.1fr]">
            <section class="border-b workspace-divider px-6 py-5 xl:border-b-0 xl:border-r">
              <div class="mb-4 flex items-center justify-between gap-3">
                <h2 class="text-sm font-bold text-on-surface">关键关注项</h2>
                <span class="text-[11px] text-outline">{{ criticalAlerts.length ? `${criticalAlerts.length} 项待处理` : '无高优先级风险' }}</span>
              </div>
              <div class="space-y-3">
                <div v-for="alert in criticalAlerts" :key="alert.title" class="workspace-subtle rounded-2xl px-4 py-4">
                  <div class="flex items-start gap-3">
                    <AppIcon :name="alert.icon" class="mt-0.5 text-primary" />
                    <div class="min-w-0 flex-1">
                      <p class="text-sm font-semibold text-on-surface">{{ alert.title }}</p>
                      <p class="mt-1 text-xs leading-6 text-on-surface-variant">{{ alert.description }}</p>
                      <button v-if="alert.action" class="mt-3 text-[11px] font-bold tracking-[0.08em] text-primary hover:underline" type="button" @click="goTo(alert.action.path)">
                        {{ alert.action.label }}
                      </button>
                    </div>
                  </div>
                </div>
                <div v-if="criticalAlerts.length === 0" class="workspace-subtle rounded-2xl px-4 py-4 text-sm text-on-surface-variant">
                  当前没有高优先级风险，Agent、MCP 和日志状态都比较稳定。
                </div>
              </div>
            </section>

            <section class="px-6 py-5">
              <div class="mb-4 flex items-center justify-between gap-3">
                <h2 class="text-sm font-bold text-on-surface">关键事件</h2>
                <span class="text-[11px] text-outline">最近 {{ recentEvents.length }} 条</span>
              </div>
              <div class="space-y-3">
                <div v-for="entry in recentEvents" :key="entry.id" class="workspace-subtle rounded-2xl px-4 py-4">
                  <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div class="min-w-0 flex-1">
                      <div class="flex flex-wrap items-center gap-2">
                        <span
                          class="rounded-full px-2 py-0.5 text-[10px] font-bold"
                          :class="entry.level === 'error'
                            ? 'bg-error-container text-on-error-container'
                            : entry.level === 'warn'
                              ? 'bg-tertiary-fixed text-on-tertiary-fixed'
                              : 'bg-primary-fixed/75 text-on-primary-fixed'"
                        >
                          {{ levelLabel(entry.level) }}
                        </span>
                        <span class="tech-text text-[11px] text-outline">{{ entry.scope || 'root' }}</span>
                      </div>
                      <p class="mt-3 text-sm font-semibold text-on-surface">{{ eventTitle(entry) }}</p>
                    </div>
                    <div class="shrink-0 text-left sm:text-right">
                      <p class="tech-text text-[11px] text-outline">{{ formatDateTime(entry.timestamp) }}</p>
                    </div>
                  </div>
                </div>
                <div v-if="recentEvents.length === 0" class="workspace-subtle rounded-2xl px-4 py-4 text-sm text-on-surface-variant">
                  暂无需要特别关注的事件。
                </div>
              </div>
            </section>
          </div>

          <div class="border-t workspace-divider px-6 py-5">
            <div class="mb-4 flex items-center justify-between">
              <h2 class="text-sm font-bold text-on-surface">最近活跃会话</h2>
              <router-link :to="{ path: '/sessions', query: token ? { token } : {} }" class="text-xs font-bold tracking-[0.08em] text-primary hover:underline">查看全部</router-link>
            </div>
            <div class="overflow-hidden rounded-2xl">
              <table class="w-full border-collapse text-left text-sm">
                <thead>
                  <tr class="border-b border-outline-variant/12 text-outline">
                    <th class="px-0 py-3 text-left text-[11px] font-bold tracking-[0.08em]">会话</th>
                    <th class="px-4 py-3 text-left text-[11px] font-bold tracking-[0.08em]">Agent</th>
                    <th class="px-0 py-3 text-left text-[11px] font-bold tracking-[0.08em]">消息数</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-outline-variant/10">
                  <tr v-for="session in recentSessions" :key="session.key" class="cursor-pointer transition-colors hover:bg-surface-container-low/35" @click="openSession(session.key)">
                    <td class="px-0 py-4">
                      <div class="flex items-center gap-3">
                        <span class="inline-block size-2 rounded-full" :class="session.messageCount > 0 ? 'bg-primary' : 'bg-outline-variant'"></span>
                        <div class="min-w-0">
                          <p class="truncate font-semibold text-on-surface">{{ session.chatId || session.key }}</p>
                          <p class="mt-1 text-[11px] text-outline">渠道 {{ session.channel || '未知' }}</p>
                        </div>
                      </div>
                    </td>
                    <td class="px-4 py-4">
                      <span class="rounded-full bg-surface-container-low px-2.5 py-1 text-[11px] font-mono text-on-surface">{{ session.agentName || 'main' }}</span>
                    </td>
                    <td class="px-0 py-4 font-mono text-xs text-on-surface-variant">{{ formatNumber(session.messageCount) }}</td>
                  </tr>
                  <tr v-if="recentSessions.length === 0">
                    <td colspan="3" class="px-0 py-8 text-center text-sm text-on-surface-variant">还没有可展示的会话记录。</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <aside class="space-y-4">
          <section class="workspace-shell rounded-[1.6rem] px-5 py-5">
            <p class="cn-kicker text-outline">状态摘要</p>
            <div class="mt-4 space-y-4">
              <div>
                <p class="text-xs text-outline">版本</p>
                <p class="mt-1 text-sm font-semibold text-on-surface">{{ status?.version || '-' }}</p>
              </div>
              <div>
                <p class="text-xs text-outline">Token 总量</p>
                <p class="mt-1 text-sm font-semibold text-on-surface">{{ usageStats ? formatNumber(usageStats.totalTokens) : '-' }}</p>
                <p class="mt-1 text-[11px] text-on-surface-variant">{{ usageStats ? `${formatNumber(usageStats.requestCount)} 次请求` : '暂无统计' }}</p>
              </div>
              <div>
                <p class="text-xs text-outline">MCP 连接</p>
                <p class="mt-1 text-sm font-semibold text-on-surface">{{ disconnectedServers > 0 ? '需要处理异常连接' : '连接正常' }}</p>
              </div>
            </div>
          </section>

          <section class="workspace-shell rounded-[1.6rem] px-5 py-5">
            <p class="cn-kicker text-outline">常用入口</p>
            <div class="mt-4 space-y-2">
              <button class="flex w-full items-center justify-between rounded-xl px-3 py-3 text-left text-sm text-on-surface transition hover:bg-surface-container-low" type="button" @click="goTo('/agents')">
                <span>检查 Agent 配置</span>
                <AppIcon name="arrowRight" size="sm" class="text-outline" />
              </button>
              <button class="flex w-full items-center justify-between rounded-xl px-3 py-3 text-left text-sm text-on-surface transition hover:bg-surface-container-low" type="button" @click="goTo('/mcp')">
                <span>检查 MCP 连接</span>
                <AppIcon name="arrowRight" size="sm" class="text-outline" />
              </button>
              <button class="flex w-full items-center justify-between rounded-xl px-3 py-3 text-left text-sm text-on-surface transition hover:bg-surface-container-low" type="button" @click="goTo('/observability/logs')">
                <span>进入观测日志</span>
                <AppIcon name="arrowRight" size="sm" class="text-outline" />
              </button>
            </div>
          </section>
        </aside>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppIcon from '@/components/AppIcon.vue';
import { rpcCall, rpcSubscribe } from '@/lib/rpc';
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
const error = ref('');
let stopStatusSubscription: (() => void) | null = null;
let stopUsageSubscription: (() => void) | null = null;
let stopSessionsSubscription: (() => void) | null = null;
let stopAgentsSubscription: (() => void) | null = null;
let stopServersSubscription: (() => void) | null = null;
let stopLogsSubscription: (() => void) | null = null;

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

function eventTitle(entry: ObservabilityLogEntry) {
  return entry.scope ? `${entry.scope} · ${abbreviateText(entry.message, 36)}` : abbreviateText(entry.message, 42);
}

async function loadOverview() {
  error.value = '';

  const [statusResult, usageResult, sessionsResult, agentsResult, serversResult, logsResult] = await Promise.all([
    rpcCall<StatusResponse>('system.getStatus', token),
    rpcCall<TokenUsageStats>('observability.getUsage', token),
    rpcCall<{ sessions: Session[] }>('sessions.list', token),
    rpcCall<{ agents: AgentRole[] }>('agents.list', token),
    rpcCall<{ servers: MCPServerInfo[] }>('mcp.list', token),
    rpcCall<{ entries: ObservabilityLogEntry[] }>('observability.getLoggingEntries', token, { limit: 12 }),
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
}

function stopSubscriptions() {
  stopStatusSubscription?.();
  stopStatusSubscription = null;
  stopUsageSubscription?.();
  stopUsageSubscription = null;
  stopSessionsSubscription?.();
  stopSessionsSubscription = null;
  stopAgentsSubscription?.();
  stopAgentsSubscription = null;
  stopServersSubscription?.();
  stopServersSubscription = null;
  stopLogsSubscription?.();
  stopLogsSubscription = null;
}

function bindSubscriptions() {
  stopSubscriptions();

  stopStatusSubscription = rpcSubscribe<StatusResponse>(
    'system.status',
    token,
    undefined,
    (data) => {
      status.value = data;
      error.value = '';
    },
    {
      onError: (message) => {
        error.value = message;
      }
    }
  );

  stopUsageSubscription = rpcSubscribe<TokenUsageStats>(
    'observability.usage',
    token,
    undefined,
    (data) => {
      usageStats.value = data;
    }
  );

  stopSessionsSubscription = rpcSubscribe<{ sessions: Session[] }>(
    'sessions.list',
    token,
    undefined,
    (data) => {
      sessions.value = data.sessions;
    }
  );

  stopAgentsSubscription = rpcSubscribe<{ agents: AgentRole[] }>(
    'agents.list',
    token,
    undefined,
    (data) => {
      agents.value = data.agents;
    }
  );

  stopServersSubscription = rpcSubscribe<{ servers: MCPServerInfo[] }>(
    'mcp.list',
    token,
    undefined,
    (data) => {
      servers.value = data.servers;
    }
  );

  stopLogsSubscription = rpcSubscribe<{ entries: ObservabilityLogEntry[] }>(
    'observability.logs',
    token,
    { limit: 12 },
    (data) => {
      logs.value = data.entries;
    }
  );
}

function openSession(sessionKey: string) {
  router.push({ path: `/dialogue/${sessionKey}`, query: token ? { token } : {} });
}

function goTo(path: string) {
  router.push({ path, query: token ? { token } : {} });
}

onMounted(() => {
  void loadOverview();
  bindSubscriptions();
});

onBeforeUnmount(() => {
  stopSubscriptions();
});
</script>
