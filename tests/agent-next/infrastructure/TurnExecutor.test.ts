import assert from 'node:assert/strict';
import test from 'node:test';
import { TurnExecutor } from '../../../src/agent-next/infrastructure/execution/TurnExecutor.js';

test('TurnExecutor delegates iterative tool work through ToolCallLoop', async () => {
  const context = {
    request: {
      channel: 'webui',
      senderId: 'user-1',
      chatId: 'chat-1',
      content: 'hello',
      timestamp: new Date(),
      messageType: 'private',
      sessionKey: 'session-1'
    },
    sessionKey: 'session-1',
    channel: 'webui',
    chatId: 'chat-1',
    messageType: 'private' as const,
    agentName: 'main',
    history: [],
    suppressOutbound: false,
    toolContext: {
      workspace: '/tmp/workspace',
      sessionKey: 'session-1',
      channel: 'webui',
      chatId: 'chat-1',
      messageType: 'private' as const
    }
  };

  const executor = new TurnExecutor({
    toolCallLoop: {
      run: async (receivedContext) => {
        assert.equal(receivedContext, context);
        return 'assistant reply';
      }
    }
  });

  const result = await executor.execute(context);
  assert.equal(result, 'assistant reply');
});
