import { ChannelRepository } from '../channels/ChannelRepository.js';
import { buildChannelStatusSnapshot } from '../channels/channelStatus.js';
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
    return {
      version: this.packageVersion,
      uptime: process.uptime(),
      channels: buildChannelStatusSnapshot(this.channelRepository),
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
