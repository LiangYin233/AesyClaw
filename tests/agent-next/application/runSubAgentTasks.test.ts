import assert from 'node:assert/strict';
import test from 'node:test';
import { runSubAgentTasks } from '../../../src/agent-next/application/turn/runSubAgentTasks.js';

test('runSubAgentTasks preserves per-task success and error results', async () => {
  const input = {
    tasks: [
      { agentName: 'researcher', task: 'find docs' },
      { agentName: 'coder', task: 'apply patch' }
    ],
    context: {
      channel: 'webui',
      chatId: 'chat-1',
      messageType: 'private' as const
    }
  };

  const result = await runSubAgentTasks({
    executeTasks: async (tasks, context) => {
      assert.deepEqual(tasks, input.tasks);
      assert.deepEqual(context, input.context);
      return [
        { agentName: 'researcher', task: 'find docs', success: true, result: 'done' },
        { agentName: 'coder', task: 'apply patch', success: false, error: 'timeout' }
      ];
    }
  }, input);

  assert.deepEqual(result, [
    { agentName: 'researcher', task: 'find docs', success: true, result: 'done' },
    { agentName: 'coder', task: 'apply patch', success: false, error: 'timeout' }
  ]);
});
