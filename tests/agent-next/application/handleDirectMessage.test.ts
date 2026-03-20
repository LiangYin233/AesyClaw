import assert from 'node:assert/strict';
import test from 'node:test';
import { handleDirectMessage } from '../../../src/agent-next/application/inbound/handleDirectMessage.js';
import type { InboundMessage } from '../../../src/types.js';

test('handleDirectMessage binds the provided reference before calling inbound flow', async () => {
  let boundMessage: InboundMessage | undefined;

  const result = await handleDirectMessage({
    bindMessageToSession: (message, reference) => {
      boundMessage = {
        ...message,
        sessionKey: typeof reference === 'string' ? reference : reference.sessionKey
      };
      return boundMessage;
    },
    handleInboundMessage: async ({ message, suppressOutbound }) => {
      assert.equal(message, boundMessage);
      assert.equal(suppressOutbound, true);
      assert.equal(message.metadata?.directResponse, true);
      return {
        status: 'replied',
        content: 'reply'
      };
    }
  }, {
    content: 'hello',
    reference: 'session-1',
    toolContextBase: {
      workspace: '/tmp/workspace'
    }
  });

  assert.equal(result, 'reply');
  assert.equal(boundMessage?.content, 'hello');
  assert.equal(boundMessage?.sessionKey, 'session-1');
});

test('handleDirectMessage returns an empty string when inbound flow has no content', async () => {
  const result = await handleDirectMessage({
    bindMessageToSession: (message) => message,
    handleInboundMessage: async () => ({
      status: 'handled'
    })
  }, {
    content: 'hello',
    reference: {
      sessionKey: 'session-1',
      channel: 'webui',
      chatId: 'chat-1',
      messageType: 'private'
    },
    suppressOutbound: false,
    toolContextBase: {
      workspace: '/tmp/workspace'
    }
  });

  assert.equal(result, '');
});
