import { SystemRepository } from './SystemRepository.js';

export class SystemApiService {
  constructor(
    private readonly packageVersion: string,
    private readonly systemRepository: SystemRepository
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
      channels: this.systemRepository.getChannelStatus(),
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
