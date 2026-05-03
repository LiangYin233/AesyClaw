import { describe, expect, it, vi } from 'vitest';
import { sessionResolver } from '../../../src/pipeline/middleware/session-resolver';
import type { PipelineState } from '../../../src/pipeline/middleware/types';
import type { SessionManager } from '../../../src/agent/session-manager';

function makeState(): PipelineState {
  return {
    stage: 'continue',
    inbound: {
      components: [{ type: 'Plain', text: 'run cron' }],
    },
    sessionKey: { channel: 'cron', type: 'job', chatId: 'job-1' },
    sendMessage: vi.fn(),
  };
}

function makeNonCronState(): PipelineState {
  return {
    stage: 'continue',
    inbound: {
      components: [{ type: 'Plain', text: 'chat message' }],
    },
    sessionKey: { channel: 'test', type: 'private', chatId: 'user-1' },
    sendMessage: vi.fn(),
  };
}

describe('sessionResolver', () => {
  it('resets cron sessions before resolving them', async () => {
    const session = { sessionId: 'session-1' };
    const sessionManager = {
      resetSession: vi.fn().mockResolvedValue(undefined),
      getOrCreateSession: vi.fn().mockResolvedValue(session),
    } as unknown as SessionManager;

    const state = makeState();
    const resolved = await sessionResolver(state, sessionManager);

    expect(sessionManager.resetSession).toHaveBeenCalledWith(state.sessionKey);
    expect(sessionManager.getOrCreateSession).toHaveBeenCalledWith(state.sessionKey);
    expect(resolved.session).toBe(session);
  });

  it('does not reset normal chat sessions', async () => {
    const session = { sessionId: 'session-1' };
    const sessionManager = {
      resetSession: vi.fn().mockResolvedValue(undefined),
      getOrCreateSession: vi.fn().mockResolvedValue(session),
    } as unknown as SessionManager;

    const state = makeNonCronState();
    await sessionResolver(state, sessionManager);

    expect(sessionManager.resetSession).not.toHaveBeenCalled();
    expect(sessionManager.getOrCreateSession).toHaveBeenCalledWith(state.sessionKey);
  });

  it('does not reset non-cron sessions', async () => {
    const session = { sessionId: 'session-1' };
    const sessionManager = {
      resetSession: vi.fn().mockResolvedValue(undefined),
      getOrCreateSession: vi.fn().mockResolvedValue(session),
    } as unknown as SessionManager;

    const state = makeNonCronState();
    await sessionResolver(state, sessionManager);

    expect(sessionManager.resetSession).not.toHaveBeenCalled();
    expect(sessionManager.getOrCreateSession).toHaveBeenCalledWith(state.sessionKey);
  });
});
