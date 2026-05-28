import { describe, expect, it, vi } from 'vitest';

import { useChat } from '../../../desktop/src/renderer/composables/useChat';

describe('desktop useChat session titles', () => {
  it('uses firstUserMessage to strip metadata even when backend title is truncated', async () => {
    vi.stubGlobal('window', {
      aesyclaw: {
        sendChatRaw: vi.fn(async () => true),
      },
    });

    try {
      const chat = useChat();
      const promise = chat.syncSessionsFromBackend();
      // flush microtasks so channelRequest stores the pending resolve
      await Promise.resolve();

      chat.handleChannelResponse('sessions', undefined, [
        {
          id: 'session-db-id',
          channel: 'desktop',
          type: 'private',
          chatId: 'desktop-chat-id',
          title: '<infomation>hidden metadata</i',
          firstUserMessage: '<infomation>hidden metadata</infomation>Visible title',
          messageCount: 1,
        },
      ]);

      await promise;

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
