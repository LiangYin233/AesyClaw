import type { RunSubAgentTasksInput } from './contracts.js';
import type { RunSubAgentTasksDeps } from './deps.js';

export async function runSubAgentTasks(
  deps: RunSubAgentTasksDeps,
  input: RunSubAgentTasksInput
): Promise<Array<{ agentName: string; task: string; success: boolean; result?: string; error?: string }>> {
  return deps.executeTasks(input.tasks, input.context);
}
