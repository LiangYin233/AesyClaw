import assert from 'node:assert/strict';
import test from 'node:test';
import { SessionResolver } from '../../../src/agent-next/infrastructure/session/SessionResolver.js';
import type { InboundMessage } from '../../../src/types.js';

function createMessage(): InboundMessage {
  return {
    channel: 'webui',
    senderId: 'user-1',
    chatId: 'chat-1',
    content: 'hello',
    timestamp: new Date(),
    messageType: 'private'
  };
}

test('SessionResolver builds tool context from inbound message metadata', async () => {
  const resolver = new SessionResolver({
    resolveSessionKey: () => 'session-1',
    getHistory: async () => [
      {
        role: 'user',
        content: 'previous',
        timestamp: new Date()
      }
    ],
    getAgentName: () => 'main'
  });

  const message = createMessage();
  const context = await resolver.resolve(message, {
    toolContext: {
      workspace: '/tmp/workspace'
    },
    suppressOutbound: true,
    memoryWindow: 20
  });

  assert.equal(message.sessionKey, 'session-1');
  assert.equal(context.sessionKey, 'session-1');
  assert.equal(context.agentName, 'main');
  assert.equal(context.suppressOutbound, true);
  assert.deepEqual(context.history, [
    {
      role: 'user',
      content: 'previous',
      timestamp: context.history[0]?.timestamp
    }
  ]);
  assert.deepEqual(context.toolContext, {
    workspace: '/tmp/workspace',
    sessionKey: 'session-1',
    channel: 'webui',
    chatId: 'chat-1',
    messageType: 'private'
  });
});
