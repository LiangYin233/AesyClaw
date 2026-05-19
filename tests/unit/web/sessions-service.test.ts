import { describe, expect, it, vi } from 'vitest';

import { getSessionMessages, getSessions } from '../../../src/web/services/sessions';

function createDeps(
  messages: Array<{ role: 'user' | 'assistant'; content: string; timestamp?: string }>,
) {
  const firstUserMessage = messages.find((message) => message.role === 'user')?.content;
  return {
    databaseManager: {
      sessions: {
        findAllSummaries: vi.fn(async () => [
          {
            id: 'session-db-id',
            channel: 'desktop',
            type: 'private',
            chatId: 'desktop-chat-id',
            lastActivity: '2026-05-18T00:00:00.000Z',
            messageCount: messages.length,
            ...(firstUserMessage ? { firstUserMessage } : {}),
          },
        ]),
      },
    },
  } as unknown as Parameters<typeof getSessions>[0];
}

describe('web session service', () => {
  it('returns session summaries without applying desktop-specific title filtering', async () => {
    const sessions = await getSessions(
      createDeps([
        {
          role: 'user',
          content: '<infomation>hidden metadata</infomation>Visible title',
        },
        { role: 'assistant', content: 'Here are the logs.' },
      ]),
    );

    expect(sessions).toEqual([
      expect.objectContaining({
        id: 'session-db-id',
        channel: 'desktop',
        chatId: 'desktop-chat-id',
        title: '<infomation>hidden metadata</i',
        messageCount: 2,
      }),
    ]);
  });

  it('falls back to chatId when there is no first user message', async () => {
    const sessions = await getSessions(createDeps([{ role: 'assistant', content: 'Hello' }]));

    expect(sessions).toEqual([
      expect.objectContaining({
        title: 'desktop-chat-id',
        messageCount: 1,
      }),
    ]);
  });

  it('returns persisted assistant usage with session messages', async () => {
    const usage = {
      input: 100,
      output: 50,
      cacheRead: 10,
      cacheWrite: 5,
      totalTokens: 165,
      cost: { input: 0.01, output: 0.02, cacheRead: 0.001, cacheWrite: 0.002, total: 0.033 },
    };
    const deps = {
      databaseManager: {
        sessions: {
          findById: vi.fn(async () => ({
            id: 'session-db-id',
            channel: 'desktop',
            type: 'private',
            chatId: 'desktop-chat-id',
          })),
        },
        messages: {
          loadHistory: vi.fn(async () => [
            { role: 'assistant', content: 'Historical reply', usage },
          ]),
        },
      },
    } as unknown as Parameters<typeof getSessionMessages>[0];

    await expect(getSessionMessages(deps, 'session-db-id')).resolves.toEqual([
      expect.objectContaining({
        role: 'assistant',
        content: 'Historical reply',
        usage,
      }),
    ]);
  });
});
