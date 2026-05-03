import { describe, expect, it, vi } from 'vitest';
import { sessionResolver } from '../../../src/pipeline/middleware/session-resolver';
import type { PipelineState } from '../../../src/pipeline/middleware/types';
import type { SessionManager } from '../../../src/agent/session-manager';

function makeState(rawEvent?: unknown): PipelineState {
  return {
    stage: 'continue',
    inbound: {
      sessionKey: { channel: 'cron', type: 'job', chatId: 'job-1' },
      components: [{ type: 'Plain', text: 'run cron' }],
      rawEvent,
    },
    sendMessage: vi.fn(),
  };
}

function makeNonCronState(rawEvent?: unknown): PipelineState {
  return {
    stage: 'continue',
    inbound: {
      sessionKey: { channel: 'test', type: 'private', chatId: 'user-1' },
      components: [{ type: 'Plain', text: 'chat message' }],
      rawEvent,
    },
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

    const state = makeState({ cronJobId: 'job-1', cronRunId: 'run-1' });
    const resolved = await sessionResolver(state, sessionManager);

    expect(sessionManager.resetSession).toHaveBeenCalledWith(state.inbound.sessionKey);
    expect(sessionManager.getOrCreateSession).toHaveBeenCalledWith(state.inbound.sessionKey);
    expect(resolved.session).toBe(session);
  });

  it('does not reset normal chat sessions', async () => {
    const session = { sessionId: 'session-1' };
    const sessionManager = {
      resetSession: vi.fn().mockResolvedValue(undefined),
      getOrCreateSession: vi.fn().mockResolvedValue(session),
    } as unknown as SessionManager;

    const state = makeState();
    await sessionResolver(state, sessionManager);

    expect(sessionManager.resetSession).not.toHaveBeenCalled();
    expect(sessionManager.getOrCreateSession).toHaveBeenCalledWith(state.inbound.sessionKey);
  });

  it('does not reset non-cron sessions even if rawEvent contains cron fields', async () => {
    const session = { sessionId: 'session-1' };
    const sessionManager = {
      resetSession: vi.fn().mockResolvedValue(undefined),
      getOrCreateSession: vi.fn().mockResolvedValue(session),
    } as unknown as SessionManager;

    const state = makeNonCronState({ cronJobId: 'job-1', cronRunId: 'run-1' });
    await sessionResolver(state, sessionManager);

    expect(sessionManager.resetSession).not.toHaveBeenCalled();
    expect(sessionManager.getOrCreateSession).toHaveBeenCalledWith(state.inbound.sessionKey);
  });
});
