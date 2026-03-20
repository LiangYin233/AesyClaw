import assert from 'node:assert/strict';
import test from 'node:test';

test('top-level agent exports resolve from src/agent after the rename', async () => {
  const mod = await import('../src/agent/index.js');

  assert.equal(typeof mod.AgentRuntime, 'function');
  assert.equal(typeof mod.SessionHandle, 'function');
  assert.equal(typeof mod.createAgentRuntime, 'function');
});
