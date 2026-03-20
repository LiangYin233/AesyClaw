import assert from 'node:assert/strict';
import test from 'node:test';
import { runAgentTurn } from '../../../src/agent-next/application/turn/runAgentTurn.js';

test('runAgentTurn delegates the turn context to the configured executor', async () => {
  const context = {
    sessionKey: 'session-1',
    channel: 'webui',
    chatId: 'chat-1',
    suppressOutbound: false,
    toolContext: {
      workspace: '/tmp/workspace',
      channel: 'webui',
      chatId: 'chat-1',
      messageType: 'private' as const
    }
  };

  const result = await runAgentTurn({
    executeTurn: async (receivedContext) => {
      assert.equal(receivedContext, context);
      return 'turn-result';
    }
  }, context);

  assert.equal(result, 'turn-result');
});
