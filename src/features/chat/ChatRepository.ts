import type { AgentRuntime } from '../../agent/index.js';

type DirectChatRequest = Parameters<Pick<AgentRuntime, 'handleDirect'>['handleDirect']>[1];

export class ChatRepository {
  constructor(private readonly agentRuntime: Pick<AgentRuntime, 'handleDirect'>) {}

  async handleDirect(message: string, request: DirectChatRequest): Promise<unknown> {
    return this.agentRuntime.handleDirect(message, request);
  }
}
