import { describe, expect, it, vi } from 'vitest';

import { useChat } from '../../../desktop/src/renderer/composables/useChat';

describe('desktop useChat history usage', () => {
  it('restores assistant usage from persisted history messages', async () => {
    const usage = {
      input: 120,
      output: 45,
      cacheRead: 10,
      cacheWrite: 5,
      totalTokens: 180,
      cost: { input: 0.01, output: 0.02, cacheRead: 0.001, cacheWrite: 0.002, total: 0.033 },
    };

    vi.stubGlobal('window', {
      aesyclaw: {
        adminRequest: vi.fn(async (type: string) => {
          if (type === 'get_sessions') {
            return {
              ok: true,
              data: [
                {
                  id: 'session-db-id',
                  channel: 'desktop',
                  type: 'private',
                  chatId: 'desktop-chat-id',
                  title: 'History usage',
                  firstUserMessage: 'History usage',
                  messageCount: 2,
                },
              ],
            };
          }

          if (type === 'get_messages') {
            return {
              ok: true,
              data: [
                { role: 'user', content: 'hello' },
                { role: 'assistant', content: 'hi', usage },
              ],
            };
          }

          return { ok: false };
        }),
      },
    });

    try {
      const chat = useChat();
      await chat.syncSessionsFromBackend();
      await chat.loadSessionMessages('desktop-chat-id');

      expect(chat.activeSession()?.messages).toEqual([
        { role: 'user', text: 'hello' },
        { role: 'assistant', text: 'hi', streaming: false, usage },
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
