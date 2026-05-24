import { describe, expect, it, vi } from 'vitest';
import { createModelCommand } from '../../../src/command/builtin/model';

const KEY = { channel: 'desktop' as const, type: 'private' as const, chatId: 'test' };

describe('createModelCommand', () => {
  it('switches model when valid identifier and agent exists', async () => {
    const setModel = vi.fn();
    const cmd = createModelCommand(
      { resolveModel: vi.fn(() => ({ provider: 'openai', modelId: 'gpt-4o' })) } as never,
      { getAgent: vi.fn(() => ({ setModel })) } as never,
    );
    const result = await cmd.execute(['openai/gpt-4o'], { sessionKey: KEY });
    expect(result).toBe('模型已切换为 openai/gpt-4o');
    expect(setModel).toHaveBeenCalledWith('openai/gpt-4o');
  });

  it('shows usage when no identifier provided', async () => {
    const cmd = createModelCommand({} as never, {} as never);
    const result = await cmd.execute([], { sessionKey: KEY });
    expect(result).toContain('用法: /model');
  });

  it('returns resolveModel error message on failure', async () => {
    const cmd = createModelCommand(
      { resolveModel: vi.fn(() => { throw new Error('Unknown provider'); }) } as never,
      {} as never,
    );
    const result = await cmd.execute(['invalid/model'], { sessionKey: KEY });
    expect(result).toContain('模型切换失败');
    expect(result).toContain('Unknown provider');
  });

  it('handles no active agent gracefully', async () => {
    const cmd = createModelCommand(
      { resolveModel: vi.fn(() => ({})) } as never,
      { getAgent: vi.fn(() => null) } as never,
    );
    const result = await cmd.execute(['openai/gpt-4o'], { sessionKey: KEY });
    expect(result).toBe('当前没有活跃的 Agent，无法切换模型。请先发送一条消息。');
  });
});
