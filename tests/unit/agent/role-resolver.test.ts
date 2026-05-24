import { describe, expect, it, vi } from 'vitest';
import { createRoleResolver } from '../../../src/agent/role-resolver';

const KEY = { channel: 'desktop' as const, type: 'private' as const, chatId: 'test' };

describe('createRoleResolver', () => {
  it('returns roleId from agent registry when agent has roleId', async () => {
    const resolver = createRoleResolver();
    const result = await resolver.resolveActiveRoleId(
      { sessionKey: KEY },
      {
        databaseManager: { sessions: { findByKey: vi.fn() }, roleBindings: { getActiveRole: vi.fn() } } as never,
        agentRegistry: { getAgent: vi.fn(() => ({ roleId: 'custom-role' })) } as never,
      },
    );
    expect(result).toBe('custom-role');
  });

  it('returns undefined when no agent and no session', async () => {
    const resolver = createRoleResolver();
    const result = await resolver.resolveActiveRoleId(
      { sessionKey: KEY },
      {
        databaseManager: { sessions: { findByKey: vi.fn(async () => null) }, roleBindings: { getActiveRole: vi.fn() } } as never,
        agentRegistry: { getAgent: vi.fn(() => null) } as never,
      },
    );
    expect(result).toBeUndefined();
  });

  it('returns active role from database when no agent roleId', async () => {
    const resolver = createRoleResolver();
    const result = await resolver.resolveActiveRoleId(
      { sessionKey: KEY },
      {
        databaseManager: {
          sessions: { findByKey: vi.fn(async () => ({ id: 1 })) },
          roleBindings: { getActiveRole: vi.fn(async () => 'db-role') },
        } as never,
        agentRegistry: { getAgent: vi.fn(() => null) } as never,
      },
    );
    expect(result).toBe('db-role');
  });

  it('prefers agent roleId over database role', async () => {
    const resolver = createRoleResolver();
    const result = await resolver.resolveActiveRoleId(
      { sessionKey: KEY },
      {
        databaseManager: {
          sessions: { findByKey: vi.fn() },
          roleBindings: { getActiveRole: vi.fn() },
        } as never,
        agentRegistry: { getAgent: vi.fn(() => ({ roleId: 'agent-role' })) } as never,
      },
    );
    expect(result).toBe('agent-role');
    // database should not be queried
  });
});
