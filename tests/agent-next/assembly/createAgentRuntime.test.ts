import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentRuntime } from '../../../src/agent/index.js';
import { buildRuntimeDeps } from '../support/fakes.js';

test('createAgentRuntime wires the facade to inbound, direct, status, and abort use cases', async () => {
  const delegate = buildRuntimeDeps();
  const runtime = createAgentRuntime({
    delegate: {
      ...delegate,
      start() {},
      stop() {},
      isRunning() {
        return true;
      }
    }
  });

  const direct = await runtime.handleDirect('ping', {
    sessionKey: 'webui:test',
    channel: 'webui',
    chatId: 'webui:test',
    messageType: 'private'
  });
  const tasks = await runtime.runSubAgentTasks([
    { agentName: 'researcher', task: 'find docs' }
  ]);
  const aborted = runtime.abortReference('session-1');
  const status = runtime.getStatusByReference('session-1');

  assert.equal(runtime.isRunning(), true);
  assert.equal(direct, 'direct:ping');
  assert.deepEqual(tasks, [
    { agentName: 'researcher', task: 'find docs', success: true, result: 'researcher:find docs' }
  ]);
  assert.equal(aborted, true);
  assert.deepEqual(status, {
    active: true,
    sessionKey: 'session-1'
  });
});
