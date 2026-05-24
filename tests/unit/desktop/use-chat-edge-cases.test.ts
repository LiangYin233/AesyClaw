import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest';
import { useChat } from '../../../desktop/src/renderer/composables/useChat';

describe('desktop useChat edge cases', () => {
  beforeAll(() => {
    vi.stubGlobal('window', {
      aesyclaw: {
        sendChat: vi.fn(async () => true),
      },
    });
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });
  it('starts with no sessions and no active session', () => {
    const chat = useChat();
    expect(chat.sessions.value).toEqual([]);
    expect(chat.activeSession.value).toBeNull();
  });

  it('creates a session with a unique id', () => {
    const chat = useChat();
    const id1 = chat.createSession();
    const id2 = chat.createSession();
    expect(id1).not.toBe(id2);
    expect(chat.sessions.value.length).toBe(2);
  });

  it('sets the newly created session as active', () => {
    const chat = useChat();
    const id = chat.createSession();
    expect(chat.activeSessionId.value).toBe(id);
    expect(chat.activeSession.value?.id).toBe(id);
  });

  it('created session has expected default state', () => {
    const chat = useChat();
    chat.createSession();
    const session = chat.activeSession.value;
    expect(session).not.toBeNull();
    expect(session!.title).toBe('新对话');
    expect(session!.messages).toEqual([]);
    expect(session!.streaming).toBe(false);
    expect(session!.pendingToolCalls).toEqual(new Map());
    expect(session!.activeAssistantMessage).toBeNull();
  });

  it('sendMessage without text and files is no-op', async () => {
    const chat = useChat();
    chat.createSession();
    await chat.sendMessage('');
    expect(chat.activeSession.value?.messages.length).toBe(0);
  });

  it('sendMessage with text adds user message', async () => {
    const chat = useChat();
    chat.createSession();
    await chat.sendMessage('Hello');
    expect(chat.activeSession.value?.messages.length).toBe(1);
    expect(chat.activeSession.value?.messages[0]).toMatchObject({
      role: 'user',
      text: 'Hello',
    });
  });

  it('sendMessage sets streaming to true', async () => {
    const chat = useChat();
    chat.createSession();
    await chat.sendMessage('Hi');
    expect(chat.activeSession.value?.streaming).toBe(true);
  });

  it('handleStreamEvent with unknown sessionId is safely ignored', () => {
    const chat = useChat();
    chat.handleStreamEvent({ type: 'chunk', sessionId: 'nonexistent', text: 'hi', index: 0 });
    // no crash
  });

  it('handleStreamEvent chunk appends to activeAssistantMessage', () => {
    const chat = useChat();
    const id = chat.createSession();
    chat.handleStreamEvent({ type: 'chunk', sessionId: id, text: 'Hello', index: 0 });
    const session = chat.activeSession.value!;
    expect(session.activeAssistantMessage?.text).toBe('Hello');
    expect(session.activeAssistantMessage?.streaming).toBe(true);
    expect(session.messages.length).toBe(1);
    expect(session.messages[0]).toMatchObject({ role: 'assistant', text: 'Hello', streaming: true });
  });

  it('multiple chunks are concatenated', () => {
    const chat = useChat();
    const id = chat.createSession();
    chat.handleStreamEvent({ type: 'chunk', sessionId: id, text: 'Hello', index: 0 });
    chat.handleStreamEvent({ type: 'chunk', sessionId: id, text: ' World', index: 1 });
    expect(chat.activeSession.value?.activeAssistantMessage?.text).toBe('Hello World');
  });

  it('tool_call creates a pending tool and marks existing assistant as intermediate', () => {
    const chat = useChat();
    const id = chat.createSession();
    // First some text, then a tool call
    chat.handleStreamEvent({ type: 'chunk', sessionId: id, text: 'Thinking...', index: 0 });
    chat.handleStreamEvent({
      type: 'tool_call',
      sessionId: id,
      toolCallId: 'tc-1',
      toolName: 'search',
      args: { query: 'test' },
    });
    const session = chat.activeSession.value!;
    expect(session.pendingToolCalls.get('tc-1')?.status).toBe('running');
    expect(session.activeAssistantMessage).toBeNull();
    // The previous assistant text should be marked intermediate
    const assistantMsg: unknown = session.messages.find((m) => m.role === 'assistant');
    if (assistantMsg !== null && assistantMsg !== undefined) {
      const msg = assistantMsg as { isIntermediate?: boolean; streaming?: boolean };
      expect(msg.isIntermediate).toBe(true);
      expect(msg.streaming).toBe(false);
    }
  });

  it('tool_result marks tool call as done', () => {
    const chat = useChat();
    const id = chat.createSession();
    chat.handleStreamEvent({
      type: 'tool_call',
      sessionId: id,
      toolCallId: 'tc-1',
      toolName: 'search',
      args: {},
    });
    chat.handleStreamEvent({
      type: 'tool_result',
      sessionId: id,
      toolCallId: 'tc-1',
      toolName: 'search',
      result: 'found it',
      isError: false,
    });
    expect(chat.activeSession.value?.pendingToolCalls.get('tc-1')?.status).toBe('done');
    expect(chat.activeSession.value?.pendingToolCalls.get('tc-1')?.isError).toBe(false);
  });

  it('tool_result with isError sets error status', () => {
    const chat = useChat();
    const id = chat.createSession();
    chat.handleStreamEvent({
      type: 'tool_call',
      sessionId: id,
      toolCallId: 'tc-1',
      toolName: 'search',
      args: {},
    });
    chat.handleStreamEvent({
      type: 'tool_result',
      sessionId: id,
      toolCallId: 'tc-1',
      toolName: 'search',
      result: 'error msg',
      isError: true,
    });
    expect(chat.activeSession.value?.pendingToolCalls.get('tc-1')?.status).toBe('error');
    expect(chat.activeSession.value?.pendingToolCalls.get('tc-1')?.isError).toBe(true);
  });

  it('done event stops streaming and clears pending tool calls', () => {
    const chat = useChat();
    const id = chat.createSession();
    chat.handleStreamEvent({ type: 'chunk', sessionId: id, text: 'Final answer', index: 0 });
    chat.handleStreamEvent({ type: 'done', sessionId: id });
    const session = chat.activeSession.value!;
    expect(session.streaming).toBe(false);
    expect(session.activeAssistantMessage).toBeNull();
    expect(session.pendingToolCalls.size).toBe(0);
  });

  it('done event with usage attaches it to the assistant message', () => {
    const chat = useChat();
    const id = chat.createSession();
    const usage = { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens: 150 };
    chat.handleStreamEvent({ type: 'chunk', sessionId: id, text: 'Answer', index: 0 });
    chat.handleStreamEvent({ type: 'done', sessionId: id, usage });
    const assistantMsg = chat.activeSession.value?.messages.find((m) => m.role === 'assistant') as
      | { role: 'assistant'; usage?: unknown }
      | undefined;
    expect(assistantMsg?.usage).toEqual(usage);
  });

  it('error event adds system message and stops streaming', () => {
    const chat = useChat();
    const id = chat.createSession();
    chat.handleStreamEvent({ type: 'error', sessionId: id, message: 'Connection lost' });
    const session = chat.activeSession.value!;
    expect(session.streaming).toBe(false);
    expect(session.messages).toContainEqual({ role: 'system', text: '错误: Connection lost' });
  });

  it('activeSessionId can be set to switch sessions', () => {
    const chat = useChat();
    const id1 = chat.createSession();
    chat.createSession();
    chat.activeSessionId.value = id1;
    expect(chat.activeSession.value?.id).toBe(id1);
  });

  it('createSession creates multiple sessions', () => {
    const chat = useChat();
    chat.createSession();
    chat.createSession();
    chat.createSession();
    expect(chat.sessions.value.length).toBe(3);
  });
});
