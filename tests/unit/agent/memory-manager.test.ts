/**
 * MemoryManager unit tests.
 *
 * Tests cover: persistMessage filtering (user, assistant text, assistant
 * with toolCalls, toolResult, empty), loadHistory, syncFromAgent, clear.
 */

import { describe, it, expect, vi } from 'vitest';
import type { AgentMessage, MemoryConfig } from '../../../src/agent/agent-types';
import { MemoryManager } from '../../../src/agent/memory-manager';
import type { MessageRepository } from '../../../src/core/database/repositories/message-repository';
import type { LlmAdapter } from '../../../src/agent/llm-adapter';

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
    summarize: vi.fn().mockResolvedValue('Conversation summary: 5 messages'),
  } as unknown as LlmAdapter;
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('MemoryManager', () => {
  const sessionId = 'test-session-id';

  // ─── persistMessage filtering ─────────────────────────────────

  describe('persistMessage', () => {
    it('should persist user messages', async () => {
      const messageRepo = makeMockMessageRepo();
      const manager = new MemoryManager(sessionId, messageRepo, defaultConfig);

      const message: AgentMessage = {
        role: 'user',
        text: 'Hello, assistant!',
      };

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

      const message: AgentMessage = {
        role: 'assistant',
        text: 'I can help with that.',
      };

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
        text: 'Let me look that up.',
        toolCalls: [{ id: 'call-1', name: 'search', arguments: '{}' }],
      };

      await manager.persistMessage(message);

      expect(messageRepo.save).not.toHaveBeenCalled();
    });

    it('should skip toolResult messages', async () => {
      const messageRepo = makeMockMessageRepo();
      const manager = new MemoryManager(sessionId, messageRepo, defaultConfig);

      const message: AgentMessage = {
        role: 'toolResult',
        text: 'Search results here...',
        toolCallId: 'call-1',
        toolName: 'search',
      };

      await manager.persistMessage(message);

      expect(messageRepo.save).not.toHaveBeenCalled();
    });

    it('should skip system messages', async () => {
      const messageRepo = makeMockMessageRepo();
      const manager = new MemoryManager(sessionId, messageRepo, defaultConfig);

      const message: AgentMessage = {
        role: 'system',
        text: 'System prompt here',
      };

      await manager.persistMessage(message);

      expect(messageRepo.save).not.toHaveBeenCalled();
    });

    it('should skip messages with empty content', async () => {
      const messageRepo = makeMockMessageRepo();
      const manager = new MemoryManager(sessionId, messageRepo, defaultConfig);

      const message: AgentMessage = {
        role: 'user',
        text: '',
      };

      await manager.persistMessage(message);

      expect(messageRepo.save).not.toHaveBeenCalled();
    });

    it('should skip messages with whitespace-only content', async () => {
      const messageRepo = makeMockMessageRepo();
      const manager = new MemoryManager(sessionId, messageRepo, defaultConfig);

      const message: AgentMessage = {
        role: 'user',
        text: '   \n\t  ',
      };

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
      expect(history[0]).toEqual({
        role: 'user',
        text: 'Hello!',
      });
      expect(history[1]).toEqual({
        role: 'assistant',
        text: 'Hi there!',
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
        { role: 'user', text: 'What is the weather?' },
        { role: 'assistant', text: 'Let me check.', toolCalls: [{ id: 'c1', name: 'weather', arguments: '{}' }] },
        { role: 'toolResult', text: 'Sunny, 72°F', toolCallId: 'c1', toolName: 'weather' },
        { role: 'assistant', text: 'The weather is sunny and 72°F.' },
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
  });

  // ─── compact ─────────────────────────────────────────────────

  describe('compact', () => {
    it('should return skip message when history is too short', async () => {
      const messageRepo = makeMockMessageRepo();
      (messageRepo.loadHistory as ReturnType<typeof vi.fn>).mockResolvedValue([
        { role: 'user', content: 'Hi', timestamp: '2025-01-01T00:00:00Z' },
      ]);

      const manager = new MemoryManager(sessionId, messageRepo, defaultConfig);
      const llmAdapter = makeMockLlmAdapter();
      const result = await manager.compact(llmAdapter);

      expect(result).toBe('Session history too short to compress.');
      expect(llmAdapter.summarize).not.toHaveBeenCalled();
      expect(messageRepo.replaceWithSummary).not.toHaveBeenCalled();
    });

    it('should summarize and replace history when enough messages exist', async () => {
      const longHistory = Array.from({ length: 10 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant' as const,
        content: `Message ${i + 1}`,
        timestamp: new Date().toISOString(),
      }));

      const messageRepo = makeMockMessageRepo();
      (messageRepo.loadHistory as ReturnType<typeof vi.fn>).mockResolvedValue(longHistory);

      const manager = new MemoryManager(sessionId, messageRepo, defaultConfig);
      const llmAdapter = makeMockLlmAdapter();
      const result = await manager.compact(llmAdapter);

      expect(llmAdapter.summarize).toHaveBeenCalled();
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