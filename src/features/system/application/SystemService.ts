import type { ChannelManager } from '../../extension/channel/ChannelManager.js';
import type { ToolRegistry } from '../../../platform/tools/ToolRegistry.js';

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
    private readonly toolRegistry?: ToolRegistry
  ) {}

  private getChannelStatus(): Record<string, { running?: boolean; enabled?: boolean; connected?: boolean }> {
    const status = this.channelManager.getStatus();
    const result: Record<string, { running?: boolean; enabled?: boolean; connected?: boolean }> = {};
    for (const s of status) {
      result[s.name] = {
        running: s.connected,
        enabled: s.connected,
        connected: s.connected
      };
    }
    return result;
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
