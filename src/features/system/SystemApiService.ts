import { ChannelRepository } from '../channels/ChannelRepository.js';
import { SystemRepository } from './SystemRepository.js';

export class SystemApiService {
  constructor(
    private readonly packageVersion: string,
    private readonly systemRepository: SystemRepository,
    private readonly channelRepository: ChannelRepository
  ) {}

  getStatus(): {
    version: string;
    uptime: number;
    channels: Record<string, { running?: boolean; enabled?: boolean; connected?: boolean }>;
    sessions: number;
    agentRunning: boolean;
  } {
    const runtimeStatus = this.channelRepository.getRuntimeStatus();
    const configuredChannels = this.channelRepository.getConfiguredChannels();
    const channels: Record<string, { running?: boolean; enabled?: boolean; connected?: boolean }> = {};

    for (const [name, config] of Object.entries(configuredChannels)) {
      const status = runtimeStatus[name];
      const running = status?.running ?? false;
      channels[name] = {
        running,
        enabled: Boolean((config as Record<string, unknown>)?.enabled),
        connected: running
      };
    }

    for (const [name, status] of Object.entries(runtimeStatus)) {
      channels[name] = {
        enabled: channels[name]?.enabled ?? true,
        running: status.running,
        connected: status.running
      };
    }

    channels.webui = {
      running: true,
      enabled: true,
      connected: true
    };

    return {
      version: this.packageVersion,
      uptime: process.uptime(),
      channels,
      sessions: this.systemRepository.getSessionCount(),
      agentRunning: this.systemRepository.isAgentRunning()
    };
  }

  getTools(): {
    tools: ReturnType<SystemRepository['getToolDefinitions']>;
  } {
    return {
      tools: this.systemRepository.getToolDefinitions()
    };
  }
}
