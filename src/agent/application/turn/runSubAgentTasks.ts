import type { ToolContext } from '../../../platform/tools/ToolRegistry.js';

export interface RunSubAgentTasksInput {
  tasks: Array<{ agentName: string; task: string }>;
  context?: Pick<ToolContext, 'channel' | 'chatId' | 'messageType' | 'signal'>;
}

export interface RunSubAgentTasksResult {
  agentName: string;
  task: string;
  success: boolean;
  result?: string;
  error?: string;
}

export interface RunSubAgentTasksDeps {
  executeTasks: (
    tasks: Array<{ agentName: string; task: string }>,
    context?: Pick<ToolContext, 'channel' | 'chatId' | 'messageType' | 'signal'>
  ) => Promise<RunSubAgentTasksResult[]>;
}

export async function runSubAgentTasks(
  deps: RunSubAgentTasksDeps,
  input: RunSubAgentTasksInput
): Promise<RunSubAgentTasksResult[]> {
  return deps.executeTasks(input.tasks, input.context);
}
