import assert from 'node:assert/strict';
import test from 'node:test';
import { assignSessionAgent, AgentRoleNotFoundError } from '../../../src/agent-next/application/session/assignSessionAgent.js';

test('assignSessionAgent clears the binding when agentName is null', async () => {
  const calls: string[] = [];

  const result = await assignSessionAgent({
    getDefaultRoleName: () => 'main',
    getSession: async () => ({
      key: 'session-1',
      channel: 'webui',
      chatId: 'chat-1'
    }),
    getResolvedRole: () => ({ name: 'unused' }),
    clearConversationAgent: (channel, chatId) => {
      calls.push(`${channel}:${chatId}`);
    },
    setConversationAgent: () => {
      throw new Error('should not assign');
    }
  }, {
    sessionKey: 'session-1',
    agentName: null
  });

  assert.deepEqual(result, {
    success: true,
    agentName: 'main'
  });
  assert.deepEqual(calls, ['webui:chat-1']);
});

test('assignSessionAgent throws when the requested role does not exist', async () => {
  await assert.rejects(
    () => assignSessionAgent({
      getDefaultRoleName: () => 'main',
      getSession: async () => ({
        key: 'session-1',
        channel: 'webui',
        chatId: 'chat-1'
      }),
      getResolvedRole: () => null,
      clearConversationAgent: () => undefined,
      setConversationAgent: () => undefined
    }, {
      sessionKey: 'session-1',
      agentName: 'missing'
    }),
    AgentRoleNotFoundError
  );
});
