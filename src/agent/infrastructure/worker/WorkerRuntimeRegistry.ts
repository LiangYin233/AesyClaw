import type {
  WorkerRuntimeEventKind,
  WorkerRuntimeNode,
  WorkerRuntimeNodeKind,
  WorkerRuntimeNodeStatus,
  WorkerRuntimeSession,
  WorkerRuntimeSnapshot,
  WorkerRuntimeToolMode
} from '../../domain/execution.js';

interface WorkerRuntimeNodeRecord {
  executionId: string;
  parentExecutionId?: string;
  sessionKey: string;
  kind: WorkerRuntimeNodeKind;
  status: WorkerRuntimeNodeStatus;
  agentName?: string;
  model?: string;
  childPid?: number | null;
  channel?: string;
  chatId?: string;
  error?: string;
  currentToolName?: string;
  currentToolMode?: WorkerRuntimeToolMode;
  currentToolStartedAt?: string;
  lastToolName?: string;
  lastToolMode?: WorkerRuntimeToolMode;
  lastToolFinishedAt?: string;
  currentLlmRequestId?: string;
  currentLlmModel?: string;
  currentLlmStartedAt?: string;
  lastLlmRequestId?: string;
  lastLlmModel?: string;
  lastLlmFinishedAt?: string;
  startedAt: string;
  updatedAt: string;
}

interface WorkerRuntimeSessionRecord {
  sessionKey: string;
  channel?: string;
  chatId?: string;
  rootExecutionId?: string;
  nodes: Map<string, WorkerRuntimeNodeRecord>;
  startedAt: string;
  updatedAt: string;
}

type WorkerRuntimeListener = () => void | Promise<void>;

export interface WorkerRuntimeLifecycleInput {
  sessionKey: string;
  executionId: string;
  parentExecutionId?: string;
  kind: WorkerRuntimeNodeKind;
  event: WorkerRuntimeEventKind;
  agentName?: string;
  model?: string;
  childPid?: number | null;
  channel?: string;
  chatId?: string;
  error?: string;
  timestamp?: string;
}

export interface WorkerRuntimeToolActivityInput {
  sessionKey: string;
  executionId: string;
  toolName?: string;
  toolMode?: WorkerRuntimeToolMode;
  active: boolean;
  timestamp?: string;
}

export interface WorkerRuntimeLlmActivityInput {
  sessionKey: string;
  executionId: string;
  requestId?: string;
  model?: string;
  active: boolean;
  timestamp?: string;
}

const ACTIVE_STATUSES = new Set<WorkerRuntimeNodeStatus>(['starting', 'running', 'aborting']);

function mapEventToStatus(event: WorkerRuntimeEventKind): WorkerRuntimeNodeStatus {
  switch (event) {
    case 'spawned':
      return 'starting';
    case 'started':
      return 'running';
    case 'aborting':
      return 'aborting';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
  }
}

function sortByUpdatedDesc<T extends { updatedAt: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function isTerminalStatus(status: WorkerRuntimeNodeStatus): boolean {
  return status === 'completed' || status === 'failed';
}

export class WorkerRuntimeRegistry {
  private readonly sessions = new Map<string, WorkerRuntimeSessionRecord>();
  private readonly listeners = new Set<WorkerRuntimeListener>();

  constructor(private readonly retentionMs = 5 * 60 * 1000) {}

  onChange(listener: WorkerRuntimeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  record(input: WorkerRuntimeLifecycleInput): void {
    this.pruneExpired();
    const timestamp = input.timestamp ?? new Date().toISOString();
    const session = this.getOrCreateSession(input.sessionKey, timestamp);
    const status = mapEventToStatus(input.event);
    const existing = session.nodes.get(input.executionId);
    const startedAt = existing?.startedAt ?? timestamp;
    const terminal = isTerminalStatus(status);
    const nextNode: WorkerRuntimeNodeRecord = {
      executionId: input.executionId,
      parentExecutionId: input.parentExecutionId ?? existing?.parentExecutionId,
      sessionKey: input.sessionKey,
      kind: input.kind ?? existing?.kind ?? 'root',
      status,
      agentName: input.agentName ?? existing?.agentName,
      model: input.model ?? existing?.model,
      childPid: input.childPid ?? existing?.childPid,
      channel: input.channel ?? existing?.channel ?? session.channel,
      chatId: input.chatId ?? existing?.chatId ?? session.chatId,
      error: input.error ?? (status === 'failed' ? existing?.error : undefined),
      currentToolName: terminal ? undefined : existing?.currentToolName,
      currentToolMode: terminal ? undefined : existing?.currentToolMode,
      currentToolStartedAt: terminal ? undefined : existing?.currentToolStartedAt,
      lastToolName: terminal ? (existing?.currentToolName ?? existing?.lastToolName) : existing?.lastToolName,
      lastToolMode: terminal
        ? (existing?.currentToolName ? existing.currentToolMode : existing?.lastToolMode)
        : existing?.lastToolMode,
      lastToolFinishedAt: terminal
        ? (existing?.currentToolName ? timestamp : existing?.lastToolFinishedAt)
        : existing?.lastToolFinishedAt,
      currentLlmRequestId: terminal ? undefined : existing?.currentLlmRequestId,
      currentLlmModel: terminal ? undefined : existing?.currentLlmModel,
      currentLlmStartedAt: terminal ? undefined : existing?.currentLlmStartedAt,
      lastLlmRequestId: terminal ? (existing?.currentLlmRequestId ?? existing?.lastLlmRequestId) : existing?.lastLlmRequestId,
      lastLlmModel: terminal
        ? (existing?.currentLlmRequestId ? existing.currentLlmModel : existing?.lastLlmModel)
        : existing?.lastLlmModel,
      lastLlmFinishedAt: terminal
        ? (existing?.currentLlmRequestId ? timestamp : existing?.lastLlmFinishedAt)
        : existing?.lastLlmFinishedAt,
      startedAt,
      updatedAt: timestamp
    };

    session.nodes.set(input.executionId, nextNode);
    session.channel = nextNode.channel ?? session.channel;
    session.chatId = nextNode.chatId ?? session.chatId;
    session.rootExecutionId = session.rootExecutionId ?? (nextNode.kind === 'root' ? nextNode.executionId : undefined);
    session.updatedAt = timestamp;
    void this.notifyListeners();
  }

  recordToolActivity(input: WorkerRuntimeToolActivityInput): void {
    this.pruneExpired();
    const timestamp = input.timestamp ?? new Date().toISOString();
    const session = this.getOrCreateSession(input.sessionKey, timestamp);
    const existing = session.nodes.get(input.executionId);
    if (!existing) {
      return;
    }

    session.nodes.set(input.executionId, {
      ...existing,
      currentToolName: input.active ? input.toolName : undefined,
      currentToolMode: input.active ? input.toolMode : undefined,
      currentToolStartedAt: input.active ? timestamp : undefined,
      lastToolName: input.active ? existing.lastToolName : (existing.currentToolName ?? input.toolName ?? existing.lastToolName),
      lastToolMode: input.active ? existing.lastToolMode : (existing.currentToolName ? existing.currentToolMode : (input.toolMode ?? existing.lastToolMode)),
      lastToolFinishedAt: input.active ? existing.lastToolFinishedAt : (existing.currentToolName || input.toolName ? timestamp : existing.lastToolFinishedAt),
      updatedAt: timestamp
    });
    session.updatedAt = timestamp;
    void this.notifyListeners();
  }

  recordLlmActivity(input: WorkerRuntimeLlmActivityInput): void {
    this.pruneExpired();
    const timestamp = input.timestamp ?? new Date().toISOString();
    const session = this.getOrCreateSession(input.sessionKey, timestamp);
    const existing = session.nodes.get(input.executionId);
    if (!existing) {
      return;
    }

    session.nodes.set(input.executionId, {
      ...existing,
      currentLlmRequestId: input.active ? input.requestId : undefined,
      currentLlmModel: input.active ? input.model : undefined,
      currentLlmStartedAt: input.active ? timestamp : undefined,
      lastLlmRequestId: input.active ? existing.lastLlmRequestId : (existing.currentLlmRequestId ?? input.requestId ?? existing.lastLlmRequestId),
      lastLlmModel: input.active ? existing.lastLlmModel : (existing.currentLlmRequestId ? existing.currentLlmModel : (input.model ?? existing.lastLlmModel)),
      lastLlmFinishedAt: input.active ? existing.lastLlmFinishedAt : (existing.currentLlmRequestId || input.requestId ? timestamp : existing.lastLlmFinishedAt),
      updatedAt: timestamp
    });
    session.updatedAt = timestamp;
    void this.notifyListeners();
  }

  snapshot(): WorkerRuntimeSnapshot {
    this.pruneExpired();
    const sessions = sortByUpdatedDesc(Array.from(this.sessions.values()))
      .map((session) => this.toSessionSnapshot(session));

    return {
      generatedAt: new Date().toISOString(),
      activeSessionCount: sessions.filter((session) => session.activeWorkerCount > 0).length,
      activeWorkerCount: sessions.reduce((sum, session) => sum + session.activeWorkerCount, 0),
      sessions
    };
  }

  private getOrCreateSession(sessionKey: string, timestamp: string): WorkerRuntimeSessionRecord {
    const existing = this.sessions.get(sessionKey);
    if (existing) {
      return existing;
    }

    const created: WorkerRuntimeSessionRecord = {
      sessionKey,
      nodes: new Map<string, WorkerRuntimeNodeRecord>(),
      startedAt: timestamp,
      updatedAt: timestamp
    };
    this.sessions.set(sessionKey, created);
    return created;
  }

  private toSessionSnapshot(session: WorkerRuntimeSessionRecord): WorkerRuntimeSession {
    const nodes = Array.from(session.nodes.values());
    const nodeMap = new Map<string, WorkerRuntimeNode>();

    for (const node of nodes) {
      nodeMap.set(node.executionId, {
        executionId: node.executionId,
        parentExecutionId: node.parentExecutionId,
        sessionKey: node.sessionKey,
        kind: node.kind,
        status: node.status,
        agentName: node.agentName,
        model: node.model,
        childPid: node.childPid,
        channel: node.channel,
        chatId: node.chatId,
        error: node.error,
        currentToolName: node.currentToolName,
        currentToolMode: node.currentToolMode,
        currentToolStartedAt: node.currentToolStartedAt,
        lastToolName: node.lastToolName,
        lastToolMode: node.lastToolMode,
        lastToolFinishedAt: node.lastToolFinishedAt,
        currentLlmRequestId: node.currentLlmRequestId,
        currentLlmModel: node.currentLlmModel,
        currentLlmStartedAt: node.currentLlmStartedAt,
        lastLlmRequestId: node.lastLlmRequestId,
        lastLlmModel: node.lastLlmModel,
        lastLlmFinishedAt: node.lastLlmFinishedAt,
        startedAt: node.startedAt,
        updatedAt: node.updatedAt,
        children: []
      });
    }

    const roots: WorkerRuntimeNode[] = [];
    for (const node of nodeMap.values()) {
      if (node.parentExecutionId) {
        const parent = nodeMap.get(node.parentExecutionId);
        if (parent) {
          parent.children.push(node);
          continue;
        }
      }

      roots.push(node);
    }

    const totalWorkerCount = nodes.length;
    const activeWorkerCount = nodes.filter((node) => ACTIVE_STATUSES.has(node.status)).length;
    const rootRecord = session.rootExecutionId ? session.nodes.get(session.rootExecutionId) : undefined;
    const status = rootRecord?.status
      ?? (activeWorkerCount > 0 ? 'running' : nodes[0]?.status ?? 'completed');

    return {
      sessionKey: session.sessionKey,
      channel: session.channel,
      chatId: session.chatId,
      status,
      startedAt: session.startedAt,
      updatedAt: session.updatedAt,
      activeWorkerCount,
      totalWorkerCount,
      rootExecutionId: session.rootExecutionId,
      workers: sortByUpdatedDesc(roots).map((node) => this.sortNodeTree(node))
    };
  }

  private sortNodeTree(node: WorkerRuntimeNode): WorkerRuntimeNode {
    node.children = sortByUpdatedDesc(node.children).map((child) => this.sortNodeTree(child));
    return node;
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [sessionKey, session] of this.sessions) {
      const active = Array.from(session.nodes.values()).some((node) => ACTIVE_STATUSES.has(node.status));
      if (active) {
        continue;
      }

      const updatedAt = Date.parse(session.updatedAt);
      if (!Number.isFinite(updatedAt)) {
        continue;
      }

      if (now - updatedAt > this.retentionMs) {
        this.sessions.delete(sessionKey);
      }
    }
  }

  private async notifyListeners(): Promise<void> {
    for (const listener of this.listeners) {
      try {
        await listener();
      } catch {
        // 监听器失败不应影响运行态主流程。
      }
    }
  }
}
