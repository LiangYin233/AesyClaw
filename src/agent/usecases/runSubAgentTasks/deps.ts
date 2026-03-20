import type { ToolContext } from '../../../tools/ToolRegistry.js';

export interface RunSubAgentTasksDeps {
  executeTasks: (
    tasks: Array<{ agentName: string; task: string }>,
    context?: Pick<ToolContext, 'channel' | 'chatId' | 'messageType' | 'signal'>
  ) => Promise<Array<{ agentName: string; task: string; success: boolean; result?: string; error?: string }>>;
}
