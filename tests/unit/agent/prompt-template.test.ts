import { describe, expect, it } from 'vitest';
import { buildAgentPrompt } from '../../../src/agent/prompt/template';

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
      promptSections: [],
    });
    expect(result).toContain('You are a helpful assistant.');
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
      promptSections: ['## 技能\n- **skill-a**: Skill skill-a'],
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
      promptSections: ['## 用户沟通\n1. **主动通报** — 使用 `send_msg` 主动向用户通报当前进展。'],
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
      promptSections: [],
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
      promptSections: [],
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
      promptSections: ['## 角色\n- **helper** — Helper role'],
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
      promptSections: [],
    });
    expect(result).not.toContain('{{os}}');
    expect(result).not.toContain('{{systemLang}}');
    expect(result).toContain(process.platform);
  });
});
