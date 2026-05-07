import { describe, expect, it, vi } from 'vitest';
import { Session } from '../../../src/session/session';
import type { AgentMessage } from '../../../src/agent/agent-types';
import type { SessionKey } from '../../../src/core/identity-types';

describe('Session.syncFromAgent', () => {
  it('removes ghost tool calls before storing assistant text', async () => {
    const messagesRepo = {
      save: vi.fn().mockResolvedValue(undefined),
      loadHistory: vi.fn().mockResolvedValue([]),
      clearHistory: vi.fn().mockResolvedValue(undefined),
      replaceWithSummary: vi.fn().mockResolvedValue(undefined),
    };

    const sessionKey: SessionKey = {
      channel: 'channel-1',
      type: 'private',
      chatId: 'chat-1',
    };

    const session = new Session('session-1', sessionKey, { messages: messagesRepo } as never);

    await session.syncFromAgent([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'hello' },
          { type: 'toolCall', id: 'ghost-call', name: '', arguments: {} },
        ],
      } as AgentMessage,
    ]);

    expect(session.get()[0]?.content).toEqual([{ type: 'text', text: 'hello' }]);
    expect(messagesRepo.save).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ role: 'assistant', content: 'hello' }),
    );
  });
});
