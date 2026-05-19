import { describe, expect, it, vi } from 'vitest';

import { useChat } from '../../../desktop/src/renderer/composables/useChat';

describe('desktop useChat session titles', () => {
  it('uses firstUserMessage to strip metadata even when backend title is truncated', async () => {
    vi.stubGlobal('window', {
      aesyclaw: {
        adminRequest: vi.fn(async (type: string) => {
          if (type !== 'get_sessions') return { ok: false };
          return {
            ok: true,
            data: [
              {
                id: 'session-db-id',
                channel: 'desktop',
                type: 'private',
                chatId: 'desktop-chat-id',
                title: '<infomation>hidden metadata</i',
                firstUserMessage: '<infomation>hidden metadata</infomation>Visible title',
                messageCount: 1,
              },
            ],
          };
        }),
      },
    });

    try {
      const chat = useChat();
      await chat.syncSessionsFromBackend();

      expect(chat.sessions.value).toEqual([
        expect.objectContaining({
          id: 'desktop-chat-id',
          title: 'Visible title',
        }),
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
