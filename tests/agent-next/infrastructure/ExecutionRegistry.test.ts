import assert from 'node:assert/strict';
import test from 'node:test';
import { ExecutionRegistry } from '../../../src/agent-next/infrastructure/execution/ExecutionRegistry.js';

test('ExecutionRegistry tracks and aborts a running session', () => {
  const registry = new ExecutionRegistry();
  const controller = new AbortController();

  registry.start('session-1', controller, {
    channel: 'webui',
    chatId: 'chat-1'
  });

  assert.deepEqual(registry.getStatus('session-1'), {
    sessionKey: 'session-1',
    active: true,
    channel: 'webui',
    chatId: 'chat-1'
  });

  assert.equal(registry.abortBySessionKey('session-1'), true);
  assert.equal(controller.signal.aborted, true);
  assert.deepEqual(registry.getStatus('session-1'), {
    sessionKey: 'session-1',
    active: false,
    channel: 'webui',
    chatId: 'chat-1'
  });

  registry.end('session-1');
  assert.equal(registry.getStatus('session-1'), undefined);
});
