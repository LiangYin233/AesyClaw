import { describe, expect, it } from 'vitest';
import { convertAgentEvent } from '../../../src/agent/runner/event-converter';

const SESSION = { channel: 'desktop' as const, type: 'private' as const, chatId: 'test' };

describe('convertAgentEvent', () => {
  it('converts text_delta to chunk signal', () => {
    const event = {
      type: 'message_update',
      message: {
        role: 'assistant',
        content: [],
        api: 'openai-responses',
        provider: 'test',
        model: 'test',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
        stopReason: 'stop',
        timestamp: Date.now(),
      },
      assistantMessageEvent: { type: 'text_delta', delta: 'Hello' },
    } as never;
    const result = convertAgentEvent(event, 0, SESSION);
    expect(result).toEqual({ kind: 'chunk', session: SESSION, text: 'Hello', index: 0 });
  });

  it('returns null for empty text delta', () => {
    const event = {
      type: 'message_update',
      message: {
        role: 'assistant',
        content: [],
        api: 'openai-responses',
        provider: 'test',
        model: 'test',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
        stopReason: 'stop',
        timestamp: Date.now(),
      },
      assistantMessageEvent: { type: 'text_delta', delta: '' },
    } as never;
    expect(convertAgentEvent(event, 0, SESSION)).toBeNull();
  });

  it('returns null for non-text_delta message_update', () => {
    const event = {
      type: 'message_update',
      message: {
        role: 'assistant',
        content: [],
        api: 'openai-responses',
        provider: 'test',
        model: 'test',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
        stopReason: 'stop',
        timestamp: Date.now(),
      },
      assistantMessageEvent: { type: 'tool_call_start', toolCallId: 'tc-1' },
    } as never;
    expect(convertAgentEvent(event, 0, SESSION)).toBeNull();
  });

  it('converts tool_execution_start to toolCall signal', () => {
    const event = {
      type: 'tool_execution_start',
      toolCallId: 'tc-1',
      toolName: 'search',
      args: { query: 'test' },
    } as never;
    const result = convertAgentEvent(event, 0, SESSION);
    expect(result).toEqual({
      kind: 'toolCall',
      session: SESSION,
      toolCallId: 'tc-1',
      toolName: 'search',
      args: { query: 'test' },
    });
  });

  it('converts tool_execution_end to toolResult signal', () => {
    const event = {
      type: 'tool_execution_end',
      toolCallId: 'tc-1',
      toolName: 'search',
      result: 'found',
      isError: false,
    } as never;
    const result = convertAgentEvent(event, 0, SESSION);
    expect(result).toEqual({
      kind: 'toolResult',
      session: SESSION,
      toolCallId: 'tc-1',
      toolName: 'search',
      result: 'found',
      isError: false,
    });
  });

  it('converts agent_end to done signal', () => {
    const event = {
      type: 'agent_end',
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'Final answer' }],
          api: 'openai-responses',
          provider: 'test',
          model: 'test',
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
          stopReason: 'stop',
          timestamp: Date.now(),
        },
      ],
    } as never;
    const result = convertAgentEvent(event, 0, SESSION);
    expect(result).toMatchObject({ kind: 'done', session: SESSION });
  });

  it('returns null for unknown event types', () => {
    const event = { type: 'unknown_event' } as never;
    expect(convertAgentEvent(event, 0, SESSION)).toBeNull();
  });

  it('passes through chunk index from caller', () => {
    const event = {
      type: 'message_update',
      message: {
        role: 'assistant',
        content: [],
        api: 'openai-responses',
        provider: 'test',
        model: 'test',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
        stopReason: 'stop',
        timestamp: Date.now(),
      },
      assistantMessageEvent: { type: 'text_delta', delta: 'Hi' },
    } as never;
    const result = convertAgentEvent(event, 5, SESSION);
    expect(result).toMatchObject({ index: 5 });
  });
});
