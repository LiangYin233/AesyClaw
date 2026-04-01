import type { AgentRuntime } from '../../agent/index.js';
import type { ChannelManager } from '../../features/extension/channel/ChannelManager.js';
import type { SessionManager } from '../../agent/infrastructure/session/SessionManager.js';
import type { PluginCoordinator } from '../../features/extension/plugin/index.js';
import type { SkillManager } from '../../features/skills/application/SkillManager.js';
import type { McpClientManager } from '../../features/mcp/index.js';
import { WebSocketApiServer } from './WebSocketApiServer.js';
import type { EventBus } from '../../platform/events/EventBus.js';
import type { AesyClawEvents } from '../../platform/events/events.js';
import { logging, tokenUsage } from '../../platform/observability/index.js';

type WorkerCapableAgentRuntime = Pick<AgentRuntime, 'handleDirect' | 'isRunning' | 'abortSession' | 'getWorkerRuntimeSnapshot' | 'onWorkerRuntimeChange'>;

export interface RegisterEventBridgesContext {
  server: WebSocketApiServer;
  agentRuntime: WorkerCapableAgentRuntime;
  sessionManager: SessionManager;
  channelManager: ChannelManager;
  skillManager?: SkillManager;
  pluginManager?: PluginCoordinator;
  getMcpManager: () => McpClientManager | undefined;
  setMcpManager: (manager: McpClientManager | undefined) => void;
  eventBus: EventBus<AesyClawEvents>;
}

function requiredString(params: unknown, field: string): string {
  const value = String(((params as Record<string, unknown>)?.[field] as string) || '').trim();
  if (!value) throw new Error(`${field} is required`);
  return value;
}

export function registerEventBridges(context: RegisterEventBridgesContext): () => void {
  const { server, agentRuntime, sessionManager, channelManager, skillManager, eventBus } = context;
  const cleanups: Array<() => void> = [];

  cleanups.push(logging.onEntry(() => { server.publish('observability.logs'); }));
  cleanups.push(tokenUsage.onChange(() => { server.publish('observability.usage'); }));

  if (skillManager) {
    cleanups.push(skillManager.onChange(() => {
      server.publish('skills.list');
      server.publish('skills.detail');
    }));
  }

  cleanups.push(agentRuntime.onWorkerRuntimeChange(() => { server.publish('agents.workerRuntime'); }));

  cleanups.push(sessionManager.onChange((event) => {
    server.publish('sessions.list');
    server.publish('system.status');
    server.publish('memory.list');
    server.publish('sessions.detail', { match: (params) => requiredString(params, 'key') === event.sessionKey });
  }));

  channelManager.on('adapter:started', () => { server.publish('system.status'); });
  channelManager.on('adapter:stopped', () => { server.publish('system.status'); });

  cleanups.push(eventBus.on('config.changed', () => {
    for (const t of ['system.status', 'agents.list', 'config.state', 'skills.list', 'skills.detail', 'plugins.list', 'mcp.list']) {
      server.publish(t);
    }
  }));

  cleanups.push(eventBus.on('mcp.tools.synced', () => {
    for (const t of ['system.status', 'system.tools', 'mcp.list', 'mcp.detail']) {
      server.publish(t);
    }
  }));

  cleanups.push(eventBus.on('plugin.runtime.updated', () => {
    for (const t of ['system.status', 'system.tools', 'plugins.list']) {
      server.publish(t);
    }
  }));

  cleanups.push(eventBus.on('cron.job.executed', () => { server.publish('cron.list'); }));
  cleanups.push(eventBus.on('cron.job.failed', () => { server.publish('cron.list'); }));

  return () => {
    for (const cleanup of cleanups) {
      cleanup();
    }
  };
}
