import { describe, expect, it } from 'vitest';

import { useChat } from '../../../desktop/src/renderer/composables/useChat';

describe('desktop useChat send_msg stream handling', () => {
  it('handles the normal send_msg flow: tool_call -> chunk -> tool_result -> done', () => {
    const chat = useChat();
    const sessionId = chat.createSession();
    const session = chat.activeSession();
    if (session) session.streaming = true;

    chat.handleStreamEvent({
      type: 'tool_call',
      sessionId,
      toolCallId: 'call-1',
      toolName: 'send_msg',
      args: { text: '处理中' },
    });

    chat.handleStreamEvent({ type: 'chunk', sessionId, text: '处理中', index: 0 });

    const afterToolCall = chat.activeSession();
    expect(afterToolCall?.pendingToolCalls.get('call-1')?.status).toBe('running');
    expect(afterToolCall?.streaming).toBe(true);

    chat.handleStreamEvent({
      type: 'tool_result',
      sessionId,
      toolCallId: 'call-1',
      toolName: 'send_msg',
      result: '消息已发送: "处理中"',
      isError: false,
    });

    const afterToolResult = chat.activeSession();
    expect(afterToolResult?.pendingToolCalls.get('call-1')?.status).toBe('done');
    expect(afterToolResult?.streaming).toBe(true);

    chat.handleStreamEvent({ type: 'done', sessionId });

    const afterFinalDone = chat.activeSession();
    expect(afterFinalDone?.streaming).toBe(false);
    expect(afterFinalDone?.pendingToolCalls.size).toBe(0);
  });
});
