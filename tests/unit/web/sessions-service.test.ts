import { describe, expect, it, vi } from 'vitest';

import { getSessions } from '../../../src/web/services/sessions';

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
  it('returns desktop session summaries with information tags stripped from titles', async () => {
    const sessions = await getSessions(
      createDeps([
        {
          role: 'user',
          content: '<information>system metadata</information>Show me the logs',
        },
        { role: 'assistant', content: 'Here are the logs.' },
      ]),
    );

    expect(sessions).toEqual([
      expect.objectContaining({
        id: 'session-db-id',
        channel: 'desktop',
        chatId: 'desktop-chat-id',
        title: 'Show me the logs',
        messageCount: 2,
      }),
    ]);
  });

  it('falls back to chatId when the first user message only contains information tags', async () => {
    const sessions = await getSessions(
      createDeps([
        {
          role: 'user',
          content: '<information>system metadata</information>',
        },
      ]),
    );

    expect(sessions).toEqual([
      expect.objectContaining({
        title: 'desktop-chat-id',
        messageCount: 1,
      }),
    ]);
  });
});
