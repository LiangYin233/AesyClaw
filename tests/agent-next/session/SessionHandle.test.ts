import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentRuntime, SessionHandle } from '../../../src/agent-next/index.js';
import { buildRuntimeDeps } from '../support/fakes.js';

test('SessionHandle binds its reference before delegating inbound handling', async () => {
  const deps = buildRuntimeDeps();
  const runtime = new AgentRuntime(deps);
  const handle = new SessionHandle(runtime, 'session-1');

  const result = await handle.handleMessage({
    channel: 'webui',
    chatId: 'chat-1',
    senderId: 'user-1',
    messageType: 'private',
    content: 'ping',
    timestamp: new Date()
  });

  assert.equal(result, 'inbound:ping');
  assert.equal(deps.calls.handleInbound, 1);
  assert.equal(deps.lastInbound?.message.sessionKey, 'session-1');
});

test('SessionHandle forwards direct execution, abort, and status lookups to the runtime', async () => {
  const deps = buildRuntimeDeps();
  const runtime = new AgentRuntime(deps);
  const handle = new SessionHandle(runtime, {
    sessionKey: 'session-1',
    channel: 'webui',
    chatId: 'chat-1',
    messageType: 'private'
  });

  const directResult = await handle.runDirect('hello');
  const aborted = handle.abort();
  const status = handle.status();

  assert.equal(directResult, 'direct:hello');
  assert.equal(aborted, true);
  assert.deepEqual(status, {
    active: true,
    sessionKey: 'session-1'
  });
});
