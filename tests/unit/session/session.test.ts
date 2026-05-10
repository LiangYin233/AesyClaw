import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { completeSimple } from '@mariozechner/pi-ai';
import type * as PiAiModule from '@mariozechner/pi-ai';
import { Session } from '../../../src/session/session';
import type { AgentMessage } from '../../../src/agent/agent-types';
import type { SessionKey } from '../../../src/core/identity-types';
import {
  clearRecentLogEntriesForTests,
  getRecentLogEntries,
  setLogLevel,
} from '../../../src/core/logger';

vi.mock('@mariozechner/pi-ai', async () => {
  const actual = await vi.importActual<typeof PiAiModule>('@mariozechner/pi-ai');
  return {
    ...actual,
    completeSimple: vi.fn(),
  };
});

beforeEach(() => {
  setLogLevel('info');
  clearRecentLogEntriesForTests();
  vi.mocked(completeSimple).mockResolvedValue(makeSummaryMessage() as never);
});

afterEach(() => {
  clearRecentLogEntriesForTests();
  vi.mocked(completeSimple).mockReset();
});

describe('Session.syncFromAgent', () => {
  it('logs total tokens over context window when compacting', async () => {
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
      { role: 'user', content: 'abcd' } as AgentMessage,
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'efgh' }],
        api: 'openai-responses',
        provider: 'openai',
        model: 'gpt-4o',
        usage: zeroUsage(),
        stopReason: 'stop',
      } as AgentMessage,
      { role: 'user', content: 'ijklmnopqrst' } as AgentMessage,
    ]);

    const llmAdapter = {
      resolveModel: vi.fn().mockReturnValue({
        apiKey: 'sk-test',
        modelId: 'gpt-4o',
        apiType: 'openai-responses',
        contextWindow: 128000,
      }),
    };

    await session.compact(llmAdapter as never, 'openai/gpt-4o');

    const compactLog = getRecentLogEntries().find((entry) => entry.message === '正在压缩会话历史');
    expect(compactLog?.details).toContain("totalTokens: '5/128000'");
  });

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

  it('persists send_msg output while syncing agent messages in order', async () => {
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
      { role: 'user', content: 'send text and file' } as AgentMessage,
      {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'call-1', name: 'send_msg', arguments: {} }],
      } as AgentMessage,
      {
        role: 'toolResult',
        toolCallId: 'call-1',
        toolName: 'send_msg',
        content: [{ type: 'text', text: '消息已发送: "visible text"' }],
        details: { persistAsAssistantText: 'visible text' },
      } as AgentMessage,
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'final reply' }],
      } as AgentMessage,
    ]);

    expect(messagesRepo.save.mock.calls.map((call) => call[1].content)).toEqual([
      'send text and file',
      'visible text',
      'final reply',
    ]);
  });
});

function makeSummaryMessage() {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: 'summary' }],
    api: 'openai-responses',
    provider: 'openai',
    model: 'gpt-4o',
    usage: zeroUsage(),
    stopReason: 'stop',
    timestamp: Date.now(),
  };
}

function zeroUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}
