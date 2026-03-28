import type {
  WorkerRuntimeNode,
  WorkerRuntimeNodeKind,
  WorkerRuntimeNodeStatus,
  WorkerRuntimeSession,
  WorkerRuntimeToolMode
} from './types';

const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit'
});

export function formatWorkerStatus(status: WorkerRuntimeNodeStatus): string {
  switch (status) {
    case 'starting':
      return '启动中';
    case 'running':
      return '运行中';
    case 'aborting':
      return '中止中';
    case 'completed':
      return '已完成';
    case 'failed':
      return '失败';
  }
}

export function workerStatusTone(status: WorkerRuntimeNodeStatus): string {
  switch (status) {
    case 'starting':
      return 'bg-sky-100 text-sky-700';
    case 'running':
      return 'bg-emerald-100 text-emerald-700';
    case 'aborting':
      return 'bg-amber-100 text-amber-700';
    case 'completed':
      return 'bg-slate-100 text-slate-700';
    case 'failed':
      return 'bg-error-container/70 text-on-error-container';
  }
}

export function workerKindLabel(kind: WorkerRuntimeNodeKind): string {
  switch (kind) {
    case 'root':
      return '主 Worker';
    case 'sub-agent':
      return '子 Agent';
    case 'temp-agent':
      return '临时 Agent';
  }
}

export function workerToolModeLabel(mode?: WorkerRuntimeToolMode): string {
  if (mode === 'bridge') {
    return '桥接';
  }

  if (mode === 'local') {
    return '本地';
  }

  return '执行中';
}

export function formatWorkerTime(value?: string): string {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return dateTimeFormatter.format(date);
}

export function shortExecutionId(value?: string): string {
  if (!value) {
    return '-';
  }

  return value.length > 12 ? value.slice(0, 12) : value;
}

export function formatSessionTarget(session: Pick<WorkerRuntimeSession, 'channel' | 'chatId'>): string {
  if (!session.channel && !session.chatId) {
    return '未绑定会话目标';
  }

  if (session.channel && session.chatId) {
    return `${session.channel} / ${session.chatId}`;
  }

  return session.channel || session.chatId || '未绑定会话目标';
}

export interface WorkerActivitySlot {
  key: 'llm' | 'tool';
  title: string;
  badge: string;
  badgeTone: string;
  borderTone: string;
  backgroundTone: string;
  accentTone: string;
  primaryText: string;
  secondaryText?: string;
  startedAt?: string;
  timeLabel?: string;
}

export function buildWorkerActivitySlots(node: WorkerRuntimeNode): WorkerActivitySlot[] {
  const llmActive = Boolean(node.currentLlmRequestId);
  const toolActive = Boolean(node.currentToolName);

  return [
    {
      key: 'llm',
      title: 'LLM',
      badge: llmActive ? '请求中' : '最近完成',
      badgeTone: 'text-tertiary',
      borderTone: 'border-tertiary/15',
      backgroundTone: llmActive ? 'bg-tertiary-fixed/30' : 'bg-surface-container-high/40',
      accentTone: 'text-tertiary',
      primaryText: llmActive ? `req: ${node.currentLlmRequestId}` : (node.lastLlmRequestId ? `req: ${node.lastLlmRequestId}` : '暂无完成记录'),
      secondaryText: llmActive ? (node.currentLlmModel || undefined) : (node.lastLlmModel || undefined),
      startedAt: llmActive ? node.currentLlmStartedAt : node.lastLlmFinishedAt,
      timeLabel: llmActive ? '开始于' : '完成于'
    },
    {
      key: 'tool',
      title: 'Tool',
      badge: toolActive ? workerToolModeLabel(node.currentToolMode) : '最近完成',
      badgeTone: 'text-primary',
      borderTone: 'border-primary/15',
      backgroundTone: toolActive ? 'bg-primary-fixed/35' : 'bg-surface-container-high/40',
      accentTone: 'text-primary',
      primaryText: node.currentToolName || node.lastToolName || '暂无完成记录',
      secondaryText: toolActive ? undefined : (node.lastToolMode ? workerToolModeLabel(node.lastToolMode) : undefined),
      startedAt: toolActive ? node.currentToolStartedAt : node.lastToolFinishedAt,
      timeLabel: toolActive ? '开始于' : '完成于'
    }
  ];
}
