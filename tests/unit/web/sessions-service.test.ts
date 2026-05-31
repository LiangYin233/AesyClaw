import { describe, expect, it, vi } from 'vitest';

import { getSessionMessages, getSessions } from '../../../src/web/services/sessions';
import type { AgentMessage } from '../../../src/agent/types';

function createDeps(summaries: unknown[]) {
  return {
    sessionManager: {
      getSummaries: vi.fn(async () => summaries),
    },
  } as unknown as Parameters<typeof getSessions>[0];
}

describe('web session service', () => {
  it('returns session summaries from SessionManager', async () => {
    const deps = createDeps([
      {
        id: 'session-db-id',
        channel: 'desktop',
        type: 'private',
        chatId: 'desktop-chat-id',
        title: '<infomation>hidden metadata</i',
        firstUserMessage: '<infomation>hidden metadata</infomation>Visible title',
        messageCount: 2,
        roleId: 'default',
        modelId: 'openai/gpt-4o',
      },
    ]);

    const sessions = await getSessions(deps);

    expect(sessions).toEqual([
      expect.objectContaining({
        id: 'session-db-id',
        channel: 'desktop',
        chatId: 'desktop-chat-id',
        title: '<infomation>hidden metadata</i',
        messageCount: 2,
        roleId: 'default',
        modelId: 'openai/gpt-4o',
      }),
    ]);
  });

  it('returns an empty summary list when SessionManager has no sessions', async () => {
    const sessions = await getSessions(createDeps([]));
    expect(sessions).toEqual([]);
  });

  it('returns persisted assistant usage as session message DTOs', async () => {
    const usage = {
      input: 100,
      output: 50,
      cacheRead: 10,
      cacheWrite: 5,
      totalTokens: 165,
      cost: { input: 0.01, output: 0.02, cacheRead: 0.001, cacheWrite: 0.002, total: 0.033 },
    };
    const deps = {
      sessionManager: {
        getMessagesById: vi.fn(async () => [
          {
            role: 'assistant',
            content: [{ type: 'text', text: 'Historical reply' }],
            usage,
            timestamp: Date.parse('2026-05-18T00:00:00.000Z'),
          } as AgentMessage,
        ]),
      },
    } as unknown as Parameters<typeof getSessionMessages>[0];

    await expect(getSessionMessages(deps, 'session-db-id')).resolves.toEqual([
      expect.objectContaining({
        role: 'assistant',
        content: 'Historical reply',
        timestamp: '2026-05-18T00:00:00.000Z',
        usage,
      }),
    ]);
    expect(deps.sessionManager.getMessagesById).toHaveBeenCalledWith('session-db-id');
  });
});
