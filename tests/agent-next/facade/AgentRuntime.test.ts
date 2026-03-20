import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentRuntime } from '../../../src/agent/index.js';
import { buildRuntimeDeps } from '../support/fakes.js';

test('AgentRuntime delegates direct handling to the configured use case', async () => {
  const deps = buildRuntimeDeps();
  const runtime = new AgentRuntime(deps);

  const result = await runtime.handleDirect('hello', {
    sessionKey: 'webui:test',
    channel: 'webui',
    chatId: 'webui:test',
    messageType: 'private'
  });

  assert.equal(result, 'direct:hello');
  assert.equal(deps.calls.handleDirect, 1);
});

test('AgentRuntime exposes abort and status queries through the configured runtime deps', () => {
  const deps = buildRuntimeDeps();
  const runtime = new AgentRuntime(deps);

  const aborted = runtime.abortReference('session-1');
  const status = runtime.getStatusByReference('session-1');

  assert.equal(aborted, true);
  assert.deepEqual(status, {
    active: true,
    sessionKey: 'session-1'
  });
  assert.equal(deps.calls.abortReference, 1);
  assert.equal(deps.calls.getStatusByReference, 1);
});
