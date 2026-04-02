import { computed, onBeforeUnmount, onMounted, readonly, ref } from 'vue';
import { rpcCall, rpcSubscribe } from '@/lib/rpc';
import { abbreviateText } from '@/lib/format';
import type { AgentRole, MCPServerInfo, ObservabilityLogEntry, Session, StatusResponse, TokenUsageStats } from '@/lib/types';

type OverviewAlert = {
  title: string;
  description: string;
  icon: string;
  tone: string;
  action?: { label: string; path: string };
};

const IMPORTANT_SCOPES = ['bootstrap', 'mcp', 'mcpruntime', 'channelmanager', 'channelruntime', 'pluginmanager', 'pluginruntimefactory', 'cron', 'cronservice'];

export function useOverviewState(token: string | null) {
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

  const recentSessions = computed(() => sessions.value.slice(0, 6));
  const totalMessages = computed(() => sessions.value.reduce((sum, session) => sum + session.messageCount, 0));
  const missingAgentCount = computed(() => agents.value.filter((agent) => agent.missingSkills.length > 0 || agent.missingTools.length > 0).length);
  const readyAgents = computed(() => agents.value.length - missingAgentCount.value);
  const disconnectedServers = computed(() => servers.value.filter((server) => server.status !== 'connected').length);
  const recentEvents = computed(() => logs.value
    .filter((entry) => {
      if (entry.level === 'warn' || entry.level === 'error') {
        return true;
      }

      if (entry.level === 'info') {
        const scope = entry.scope?.toLowerCase() || '';
        return IMPORTANT_SCOPES.some((item) => scope.includes(item));
      }

      return false;
    })
    .slice(0, 4)
  );

  const criticalAlerts = computed<OverviewAlert[]>(() => {
    const alerts: OverviewAlert[] = [];

    const missingAgent = agents.value.find((agent) => agent.missingSkills.length > 0 || agent.missingTools.length > 0);
    if (missingAgent) {
      alerts.push({
        title: `Agent "${missingAgent.name}" 缺少必要的技能或工具`,
        description: `缺失技能 ${missingAgent.missingSkills.join('、') || '无'}；缺失工具 ${missingAgent.missingTools.join('、') || '无'}。建议先补齐再投入运行。`,
        icon: 'warning',
        tone: 'border-error bg-error-container/25 text-error',
        action: { label: '前往处理', path: '/agents' }
      });
    }

    const failedServer = servers.value.find((server) => server.status !== 'connected');
    if (failedServer) {
      alerts.push({
        title: `MCP 服务 "${failedServer.name}" 连接失败了`,
        description: failedServer.error || '服务目前未连接，依赖它的工具可能无法使用。',
        icon: 'mcp',
        tone: 'border-tertiary bg-tertiary-fixed/20 text-tertiary',
        action: { label: '查看 MCP', path: '/mcp' }
      });
    }

    const errorLog = logs.value.find((entry) => entry.level === 'error');
    if (errorLog) {
      alerts.push({
        title: '近期存在错误日志',
        description: abbreviateText(errorLog.message, 88),
        icon: 'observability',
        tone: 'border-outline bg-surface-container-low text-on-surface',
        action: { label: '查看观测', path: '/observability/logs' }
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
      rpcCall<{ entries: ObservabilityLogEntry[] }>('observability.getLoggingEntries', token, { limit: 12 })
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

  onMounted(() => {
    void loadOverview();
    bindSubscriptions();
  });

  onBeforeUnmount(() => {
    stopSubscriptions();
  });

  return {
    status: readonly(status),
    usageStats: readonly(usageStats),
    sessions: readonly(sessions),
    agents: readonly(agents),
    servers: readonly(servers),
    error: readonly(error),
    recentSessions,
    totalMessages,
    missingAgentCount,
    readyAgents,
    disconnectedServers,
    recentEvents,
    criticalAlerts,
    levelLabel,
    eventTitle
  };
}
