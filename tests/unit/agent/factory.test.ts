import { describe, expect, it, vi } from 'vitest';
import { createAgentFactory } from '../../../src/agent/factory';

describe('createAgentFactory', () => {
  it('creates an AgentFactory object', () => {
    const deps = {
      llmAdapter: {} as never,
      roleManager: {} as never,
      skillManager: {} as never,
      toolRegistry: {} as never,
      hooksBus: {} as never,
      compressionThreshold: 0.5,
      agentRegistry: { registerAgent: vi.fn() } as never,
    };
    const factory = createAgentFactory(deps);
    expect(factory).toHaveProperty('create');
    expect(typeof factory.create).toBe('function');
  });
});
