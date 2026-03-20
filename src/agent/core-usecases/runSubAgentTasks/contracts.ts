import type { ToolContext } from '../../../tools/ToolRegistry.js';

export interface RunSubAgentTasksInput {
  tasks: Array<{ agentName: string; task: string }>;
  context?: Pick<ToolContext, 'channel' | 'chatId' | 'messageType' | 'signal'>;
}
