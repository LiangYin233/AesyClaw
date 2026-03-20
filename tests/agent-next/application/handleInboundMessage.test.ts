import assert from 'node:assert/strict';
import test from 'node:test';
import { handleInboundMessage } from '../../../src/agent/application/inbound/handleInboundMessage.js';
import type { InboundMessage } from '../../../src/types.js';

function createMessage(): InboundMessage {
  return {
    channel: 'webui',
    senderId: 'user-1',
    chatId: 'chat-1',
    content: 'hello',
    timestamp: new Date(),
    messageType: 'private',
    sessionKey: 'session-1'
  };
}

test('handleInboundMessage returns handled when preprocessing fully consumes the message', async () => {
  let resolveCalled = false;
  let runTurnCalled = false;

  const result = await handleInboundMessage({
    logInbound: () => undefined,
    processInbound: async () => ({ type: 'handled' }),
    resolveTurnContext: async () => {
      resolveCalled = true;
      throw new Error('should not resolve');
    },
    runTurn: async () => {
      runTurnCalled = true;
      return 'unexpected';
    },
    logCompletion: () => undefined
  }, {
    message: createMessage(),
    toolContextBase: {
      workspace: '/tmp/workspace'
    }
  });

  assert.deepEqual(result, { status: 'handled' });
  assert.equal(resolveCalled, false);
  assert.equal(runTurnCalled, false);
});

test('handleInboundMessage resolves turn context and logs completion for executable messages', async () => {
  const events: string[] = [];
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

  const result = await handleInboundMessage({
    logInbound: () => {
      events.push('logInbound');
    },
    processInbound: async () => {
      events.push('processInbound');
      return {
        type: 'continue',
        message: createMessage()
      };
    },
    resolveTurnContext: async () => {
      events.push('resolveTurnContext');
      return context;
    },
    runTurn: async (receivedContext) => {
      events.push('runTurn');
      assert.equal(receivedContext, context);
      return 'assistant reply';
    },
    logCompletion: (receivedContext) => {
      events.push('logCompletion');
      assert.equal(receivedContext, context);
    }
  }, {
    message: createMessage(),
    suppressOutbound: false,
    toolContextBase: {
      workspace: '/tmp/workspace'
    }
  });

  assert.deepEqual(result, {
    status: 'executed',
    content: 'assistant reply'
  });
  assert.deepEqual(events, [
    'logInbound',
    'processInbound',
    'resolveTurnContext',
    'runTurn',
    'logCompletion'
  ]);
});
