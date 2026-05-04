/**
 * MemoryManager unit tests.
 *
 * Tests cover: persistMessage filtering (user, assistant text, assistant
 * with toolCalls, toolResult, empty), loadHistory, syncFromAgent, clear.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentMessage, MemoryConfig } from '../../../src/agent/agent-types';
import { MemoryManager } from '../../../src/agent/memory-manager';
import { createPersistedAssistantMessage, createUserMessage } from '../../../src/agent/agent-types';
import type { MessageRepository } from '../../../src/core/database/repositories/message-repository';
import { summarizeConversation } from '../../../src/agent/llm-features';

vi.mock('../../../src/agent/llm-features', async () => {
  return {
    summarizeConversation: vi.fn(),
  };
});

// ─── Helpers ──────────────────────────────────────────────────────

const defaultConfig: MemoryConfig = {
  maxContextTokens: 128000,
  compressionThreshold: 0.8,
};

function makeMockMessageRepo() {
  return {
    save: vi.fn().mockResolvedValue(undefined),
    loadHistory: vi.fn().mockResolvedValue([]),
    clearHistory: vi.fn().mockResolvedValue(undefined),
    replaceWithSummary: vi.fn().mockResolvedValue(undefined),
  } as unknown as MessageRepository;
}

function makeMockLlmAdapter() {
  return {
    resolveModel: vi.fn().mockReturnValue({
      provider: 'openai',
      modelId: 'gpt-4o',
      apiKey: 'sk-test-key',
      apiType: 'openai-responses',
      input: ['text'],
    }),
  };
}

function makeMockUsageRepo() {
  return {
    create: vi.fn().mockResolvedValue(1),
  };
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('MemoryManager', () => {
  const sessionId = 'test-session-id';

  beforeEach(() => {
    vi.mocked(summarizeConversation).mockReset();
  });

  // ─── persistMessage filtering ─────────────────────────────────

  describe('persistMessage', () => {
    it('should persist user messages', async () => {
      const messageRepo = makeMockMessageRepo();
      const manager = new MemoryManager(sessionId, messageRepo, defaultConfig);

      const message: AgentMessage = createUserMessage('Hello, assistant!');

      await manager.persistMessage(message);

      expect(messageRepo.save).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({
          role: 'user',
          content: 'Hello, assistant!',
        }),
      );
    });

    it('should persist pure-text assistant messages', async () => {
      const messageRepo = makeMockMessageRepo();
      const manager = new MemoryManager(sessionId, messageRepo, defaultConfig);

      const message: AgentMessage = createPersistedAssistantMessage('I can help with that.');

      await manager.persistMessage(message);

      expect(messageRepo.save).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({
          role: 'assistant',
          content: 'I can help with that.',
        }),
      );
    });

    it('should skip assistant messages with toolCalls', async () => {
      const messageRepo = makeMockMessageRepo();
      const manager = new MemoryManager(sessionId, messageRepo, defaultConfig);

      const message: AgentMessage = {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me look that up.' },
          { type: 'toolCall', id: 'call-1', name: 'search', arguments: {} },
        ],
        api: 'openai-responses',
        provider: 'openai',
        model: 'gpt-4o',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'toolUse',
        timestamp: Date.now(),
      };

      await manager.persistMessage(message);

      expect(messageRepo.save).not.toHaveBeenCalled();
    });

    it('should skip toolResult messages', async () => {
      const messageRepo = makeMockMessageRepo();
      const manager = new MemoryManager(sessionId, messageRepo, defaultConfig);

      const message: AgentMessage = {
        role: 'toolResult',
        content: [{ type: 'text', text: 'Search results here...' }],
        toolCallId: 'call-1',
        toolName: 'search',
        isError: false,
        timestamp: Date.now(),
      };

      await manager.persistMessage(message);

      expect(messageRepo.save).not.toHaveBeenCalled();
    });

    it('should skip system messages', async () => {
      const messageRepo = makeMockMessageRepo();
      const manager = new MemoryManager(sessionId, messageRepo, defaultConfig);

      const message = {
        role: 'system',
        content: 'System prompt here',
        timestamp: Date.now(),
      } as AgentMessage;

      await manager.persistMessage(message);

      expect(messageRepo.save).not.toHaveBeenCalled();
    });

    it('should skip messages with empty content', async () => {
      const messageRepo = makeMockMessageRepo();
      const manager = new MemoryManager(sessionId, messageRepo, defaultConfig);

      const message: AgentMessage = createUserMessage('');

      await manager.persistMessage(message);

      expect(messageRepo.save).not.toHaveBeenCalled();
    });

    it('should skip messages with whitespace-only content', async () => {
      const messageRepo = makeMockMessageRepo();
      const manager = new MemoryManager(sessionId, messageRepo, defaultConfig);

      const message: AgentMessage = createUserMessage('   \n\t  ');

      await manager.persistMessage(message);

      expect(messageRepo.save).not.toHaveBeenCalled();
    });
  });

  // ─── loadHistory ──────────────────────────────────────────────

  describe('loadHistory', () => {
    it('should load messages from DB and convert to AgentMessage format', async () => {
      const messageRepo = makeMockMessageRepo();
      (messageRepo.loadHistory as ReturnType<typeof vi.fn>).mockResolvedValue([
        { role: 'user', content: 'Hello!', timestamp: '2025-01-01T00:00:00Z' },
        { role: 'assistant', content: 'Hi there!', timestamp: '2025-01-01T00:00:01Z' },
      ]);

      const manager = new MemoryManager(sessionId, messageRepo, defaultConfig);
      const history = await manager.loadHistory();

      expect(history).toHaveLength(2);
      expect(history[0]).toMatchObject({ role: 'user', content: 'Hello!' });
      expect(history[1]).toMatchObject({
        role: 'assistant',
        content: [{ type: 'text', text: 'Hi there!' }],
      });
    });

    it('should return empty array when no messages exist', async () => {
      const messageRepo = makeMockMessageRepo();
      (messageRepo.loadHistory as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const manager = new MemoryManager(sessionId, messageRepo, defaultConfig);
      const history = await manager.loadHistory();

      expect(history).toEqual([]);
    });
  });

  // ─── syncFromAgent ────────────────────────────────────────────

  describe('syncFromAgent', () => {
    it('should persist only filterable messages from agent state', async () => {
      const messageRepo = makeMockMessageRepo();
      const manager = new MemoryManager(sessionId, messageRepo, defaultConfig);

      const messages: AgentMessage[] = [
        createUserMessage('What is the weather?'),
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Let me check.' },
            { type: 'toolCall', id: 'c1', name: 'weather', arguments: {} },
          ],
          api: 'openai-responses',
          provider: 'openai',
          model: 'gpt-4o',
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: 'toolUse',
          timestamp: Date.now(),
        },
        {
          role: 'toolResult',
          content: [{ type: 'text', text: 'Sunny, 72°F' }],
          toolCallId: 'c1',
          toolName: 'weather',
          isError: false,
          timestamp: Date.now(),
        },
        createPersistedAssistantMessage('The weather is sunny and 72°F.'),
      ];

      await manager.syncFromAgent(messages);

      // Only the user message and the final pure-text assistant message should be persisted
      expect(messageRepo.save).toHaveBeenCalledTimes(2);
      expect(messageRepo.save).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({ role: 'user', content: 'What is the weather?' }),
      );
      expect(messageRepo.save).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({ role: 'assistant', content: 'The weather is sunny and 72°F.' }),
      );
    });

    it('should use the same persistence and usage accounting path as persistMessage', async () => {
      const messageRepo = makeMockMessageRepo();
      const usageRepo = makeMockUsageRepo();
      const manager = new MemoryManager(sessionId, messageRepo, defaultConfig, usageRepo);
      const message: AgentMessage = {
        ...createPersistedAssistantMessage('Done.'),
        api: 'openai-responses',
        provider: 'openai',
        model: 'gpt-4o',
        usage: {
          input: 1,
          output: 2,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 3,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      };

      await manager.syncFromAgent([message]);

      expect(messageRepo.save).toHaveBeenCalledTimes(1);
      expect(usageRepo.create).toHaveBeenCalledTimes(1);
    });
  });

  // ─── compact ─────────────────────────────────────────────────

  describe('compact', () => {
    it('should report when history crosses the configured compression threshold', () => {
      const messageRepo = makeMockMessageRepo();
      const manager = new MemoryManager(sessionId, messageRepo, {
        maxContextTokens: 10,
        compressionThreshold: 0.5,
      });

      expect(manager.shouldCompact([createUserMessage('x'.repeat(24))])).toBe(true);
      expect(manager.shouldCompact([createUserMessage('short')])).toBe(false);
    });

    it('should return skip message when history is too short', async () => {
      const messageRepo = makeMockMessageRepo();
      (messageRepo.loadHistory as ReturnType<typeof vi.fn>).mockResolvedValue([
        { role: 'user', content: 'Hi', timestamp: '2025-01-01T00:00:00Z' },
      ]);

      const manager = new MemoryManager(sessionId, messageRepo, defaultConfig);
      const llmAdapter = makeMockLlmAdapter();
      const result = await manager.compact(llmAdapter, 'openai/gpt-4o');

      expect(result).toBe('会话历史太短，无需压缩。');
      expect(llmAdapter.resolveModel).not.toHaveBeenCalled();
      expect(summarizeConversation).not.toHaveBeenCalled();
      expect(messageRepo.replaceWithSummary).not.toHaveBeenCalled();
    });

    it('should summarize and replace history when enough messages exist', async () => {
      vi.mocked(summarizeConversation).mockResolvedValue('Conversation summary: 5 messages');

      const longHistory = Array.from({ length: 10 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : ('assistant' as const),
        content: `Message ${i + 1}`,
        timestamp: new Date().toISOString(),
      }));

      const messageRepo = makeMockMessageRepo();
      (messageRepo.loadHistory as ReturnType<typeof vi.fn>).mockResolvedValue(longHistory);

      const manager = new MemoryManager(sessionId, messageRepo, defaultConfig);
      const llmAdapter = makeMockLlmAdapter();
      const result = await manager.compact(llmAdapter, 'openai/gpt-4o');

      expect(llmAdapter.resolveModel).toHaveBeenCalledWith('openai/gpt-4o');
      expect(summarizeConversation).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'openai', modelId: 'gpt-4o' }),
        expect.any(Array),
        sessionId,
      );
      expect(messageRepo.replaceWithSummary).toHaveBeenCalledWith(sessionId, result);
    });
  });

  // ─── clear ────────────────────────────────────────────────────

  describe('clear', () => {
    it('should clear all messages for the session', async () => {
      const messageRepo = makeMockMessageRepo();
      const manager = new MemoryManager(sessionId, messageRepo, defaultConfig);

      await manager.clear();

      expect(messageRepo.clearHistory).toHaveBeenCalledWith(sessionId);
    });
  });
});
