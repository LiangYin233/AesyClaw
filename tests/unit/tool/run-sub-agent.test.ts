import { describe, expect, it, vi } from 'vitest';
import {
  createRunSubAgentTool,
  createRunTempSubAgentTool,
} from '../../../src/tool/builtin/run-sub-agent';

const SESSION_KEY = { channel: 'desktop' as const, type: 'private' as const, chatId: 'test' };
const CTX = { sessionKey: SESSION_KEY } as never;

describe('createRunSubAgentTool', () => {
  it('runs sub-agent and returns result', async () => {
    const callLLM = vi.fn(async () => ({
      newMessages: [
        { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'Task done' }] },
      ],
      lastAssistant: 'Task done',
    }));
    const tool = createRunSubAgentTool({
      roleManager: {
        getRole: vi.fn(() => ({
          id: 'helper',
          description: '',
          systemPrompt: 'You help.',
          model: 'openai/gpt-4o-mini',
          toolPermission: { mode: 'denylist', list: [] },
          skills: [],
          enabled: true,
        })),
      },
      callLLM,
    });
    const result = await tool.execute({ roleId: 'helper', prompt: 'Do something' }, CTX);
    expect(result.content).toContain('Task done');
  });

  it('returns error when role not found', async () => {
    const tool = createRunSubAgentTool({
      roleManager: { getRole: vi.fn(() => undefined) },
      callLLM: vi.fn(),
    });
    const result = await tool.execute({ roleId: 'nonexistent', prompt: 'test' }, CTX);
    expect(result.isError).toBe(true);
    expect(result.content).toContain('子代理执行失败');
  });

  it('passes enableTools flag to override tool permissions', async () => {
    const callLLM = vi.fn(async () => ({
      newMessages: [],
      lastAssistant: null,
    }));
    const tool = createRunSubAgentTool({
      roleManager: {
        getRole: vi.fn(() => ({
          id: 'helper',
          description: '',
          systemPrompt: 'You help.',
          model: 'openai/gpt-4o-mini',
          toolPermission: { mode: 'denylist', list: [] },
          skills: [],
          enabled: true,
        })),
      },
      callLLM,
    });
    const result = await tool.execute({ roleId: 'helper', prompt: 'test', enableTools: true }, CTX);
    expect(result.isError).toBeFalsy();
  });
});

describe('createRunTempSubAgentTool', () => {
  it('runs temp sub-agent with inline system prompt', async () => {
    const callLLM = vi.fn(async () => ({
      newMessages: [
        { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'Done' }] },
      ],
      lastAssistant: 'Done',
    }));
    const tool = createRunTempSubAgentTool({
      roleManager: {
        getDefaultRole: vi.fn(() => ({
          id: 'temp',
          description: '',
          systemPrompt: 'Temp',
          model: 'openai/gpt-4o-mini',
          toolPermission: { mode: 'denylist', list: [] },
          skills: [],
          enabled: true,
        })),
      },
      callLLM,
    });
    const result = await tool.execute(
      { systemPrompt: 'You are a translator', prompt: 'Translate hello' },
      CTX,
    );
    expect(result.content).toContain('Done');
  });
});
