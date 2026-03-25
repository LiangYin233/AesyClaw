import type { AgentRuntime } from '../../agent/index.js';
import type { ChannelManager } from '../channels/application/ChannelManager.js';
import type { SessionManager } from '../sessions/application/SessionManager.js';
import type { ToolRegistry } from '../../platform/tools/ToolRegistry.js';
import type { Config } from '../../types.js';
import { buildChannelStatusSnapshot, type ChannelStatusSnapshot } from '../channels/application/channelStatusSnapshot.js';

export class SystemRepository {
  constructor(
    private readonly agentRuntime: Pick<AgentRuntime, 'isRunning'>,
    private readonly sessionManager: Pick<SessionManager, 'count'>,
    private readonly channelManager: ChannelManager,
    private readonly getConfig: () => Config,
    private readonly toolRegistry?: ToolRegistry
  ) {}

  isAgentRunning(): boolean {
    return this.agentRuntime.isRunning();
  }

  getSessionCount(): number {
    return this.sessionManager.count();
  }

  getChannelStatus(): ChannelStatusSnapshot {
    return buildChannelStatusSnapshot({
      runtimeStatus: this.channelManager.getStatus(),
      configuredChannels: this.getConfig().channels
    });
  }

  getToolDefinitions(): ReturnType<ToolRegistry['getDefinitions']> | [] {
    return this.toolRegistry?.getDefinitions() ?? [];
  }
}
