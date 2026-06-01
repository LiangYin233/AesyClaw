import { describe, expect, it } from 'vitest';
import { buildAgentPrompt } from '../../../src/agent/prompt/template';

const makeTool = (name: string, description: string) => ({
  name,
  description,
  parameters: {} as never,
  owner: 'system' as const,
  execute: async () => ({ content: '' }),
});

describe('buildAgentPrompt', () => {
  it('includes system prompt', () => {
    const result = buildAgentPrompt({
      role: {
        id: 'test',
        description: '',
        systemPrompt: 'You are a helpful assistant.',
        model: 'gpt-4o',
        toolPermission: { mode: 'denylist', list: [] },
        skills: [],
        enabled: true,
      },
      availableTools: [],
      promptSections: [],
      allRoles: [],
      isSubAgent: false,
      isCron: false,
    });
    expect(result).toContain('You are a helpful assistant.');
  });

  it('includes tool section when tools are available', () => {
    const result = buildAgentPrompt({
      role: {
        id: 'test',
        description: '',
        systemPrompt: 'You are a bot.',
        model: 'gpt-4o',
        toolPermission: { mode: 'denylist', list: [] },
        skills: [],
        enabled: true,
      },
      availableTools: [makeTool('search', 'Search the web')],
      promptSections: [],
      allRoles: [],
      isSubAgent: false,
      isCron: false,
    });
    expect(result).toContain('## Available Tools');
    expect(result).toContain('search');
    expect(result).toContain('Search the web');
  });

  it('includes skill section when skills are present', () => {
    const result = buildAgentPrompt({
      role: {
        id: 'test',
        description: '',
        systemPrompt: 'You are a bot.',
        model: 'gpt-4o',
        toolPermission: { mode: 'denylist', list: [] },
        skills: ['skill-a'],
        enabled: true,
      },
      availableTools: [],
      promptSections: ['## 技能\n- **skill-a**: Skill skill-a'],
      allRoles: [],
      isSubAgent: false,
      isCron: false,
    });
    expect(result).toContain('skill-a');
  });

  it('includes user communication section for normal agents', () => {
    const result = buildAgentPrompt({
      role: {
        id: 'test',
        description: '',
        systemPrompt: 'Be helpful.',
        model: 'gpt-4o',
        toolPermission: { mode: 'denylist', list: [] },
        skills: [],
        enabled: true,
      },
      availableTools: [makeTool('send_msg', 'Send message to user')],
      promptSections: [],
      allRoles: [],
      isSubAgent: false,
      isCron: false,
    });
    expect(result).toContain('send_msg');
    expect(result).toContain('用户沟通');
  });

  it('omits user communication section for sub-agents', () => {
    const result = buildAgentPrompt({
      role: {
        id: 'test',
        description: '',
        systemPrompt: 'Be helpful.',
        model: 'gpt-4o',
        toolPermission: { mode: 'denylist', list: [] },
        skills: [],
        enabled: true,
      },
      availableTools: [makeTool('search', 'Search')],
      promptSections: [],
      allRoles: [],
      isSubAgent: true,
      isCron: false,
    });
    expect(result).not.toContain('用户沟通');
  });

  it('omits user communication section for cron jobs', () => {
    const result = buildAgentPrompt({
      role: {
        id: 'test',
        description: '',
        systemPrompt: 'Be helpful.',
        model: 'gpt-4o',
        toolPermission: { mode: 'denylist', list: [] },
        skills: [],
        enabled: true,
      },
      availableTools: [makeTool('search', 'Search')],
      promptSections: [],
      allRoles: [],
      isSubAgent: false,
      isCron: true,
    });
    expect(result).not.toContain('用户沟通');
  });

  it('includes role section when other roles exist', () => {
    const result = buildAgentPrompt({
      role: {
        id: 'main',
        description: '',
        systemPrompt: 'You are main.',
        model: 'gpt-4o',
        toolPermission: { mode: 'denylist', list: [] },
        skills: [],
        enabled: true,
      },
      availableTools: [],
      promptSections: [],
      allRoles: [
        {
          id: 'helper',
          description: 'Helper role',
          systemPrompt: 'You help.',
          model: 'gpt-4o-mini',
          toolPermission: { mode: 'denylist', list: [] },
          skills: [],
          enabled: true,
        },
      ],
      isSubAgent: false,
      isCron: false,
    });
    expect(result).toContain('helper');
    expect(result).toContain('Helper role');
  });

  it('replaces template variables', () => {
    const result = buildAgentPrompt({
      role: {
        id: 'test',
        description: '',
        systemPrompt: 'Running on {{os}} with {{systemLang}}.',
        model: 'gpt-4o',
        toolPermission: { mode: 'denylist', list: [] },
        skills: [],
        enabled: true,
      },
      availableTools: [],
      promptSections: [],
      allRoles: [],
      isSubAgent: false,
      isCron: false,
    });
    expect(result).not.toContain('{{os}}');
    expect(result).not.toContain('{{systemLang}}');
    expect(result).toContain(process.platform);
  });
});
