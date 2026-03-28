import type { ChannelManager } from '../../channels/application/ChannelManager.js';
import { buildChannelStatusSnapshot, type ChannelStatusSnapshot } from '../../channels/application/channelStatusSnapshot.js';
import type { ToolRegistry } from '../../../platform/tools/ToolRegistry.js';
import type { Config } from '../../../types.js';

interface AgentStatusChecker {
  isRunning(): boolean;
}

interface SessionCounter {
  count(): number;
}

export class SystemService {
  constructor(
    private readonly packageVersion: string,
    private readonly agentRuntime: AgentStatusChecker,
    private readonly sessionManager: SessionCounter,
    private readonly channelManager: ChannelManager,
    private readonly getConfig: () => Config,
    private readonly toolRegistry?: ToolRegistry
  ) {}

  private getChannelStatus(): ChannelStatusSnapshot {
    return buildChannelStatusSnapshot({
      runtimeStatus: this.channelManager.getStatus(),
      configuredChannels: this.getConfig().channels
    });
  }

  getStatus(): {
    version: string;
    uptime: number;
    channels: Record<string, { running?: boolean; enabled?: boolean; connected?: boolean }>;
    sessions: number;
    agentRunning: boolean;
  } {
    return {
      version: this.packageVersion,
      uptime: process.uptime(),
      channels: this.getChannelStatus(),
      sessions: this.sessionManager.count(),
      agentRunning: this.agentRuntime.isRunning()
    };
  }

  getTools(): {
    tools: ReturnType<ToolRegistry['getDefinitions']> | [];
  } {
    return {
      tools: this.toolRegistry?.getDefinitions() ?? []
    };
  }
}
