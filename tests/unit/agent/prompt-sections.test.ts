import { describe, expect, it } from 'vitest';
import { buildRoleSection, buildSkillSection } from '../../../src/agent/prompt/sections';

describe('buildRoleSection', () => {
  it('builds section with one role', () => {
    const roles = [
      {
        id: 'helper',
        description: 'Helpful assistant',
        systemPrompt: '',
        model: 'gpt-4o',
        toolPermission: { mode: 'denylist' as const, list: [] },
        skills: [],
        enabled: true,
      },
    ];
    const result = buildRoleSection(roles);
    expect(result).toContain('## 角色');
    expect(result).toContain('**helper**');
    expect(result).toContain('Helpful assistant');
    expect(result).toContain('### 角色使用规则');
  });

  it('builds section with multiple roles', () => {
    const roles = [
      {
        id: 'coder',
        description: 'Writes code',
        systemPrompt: '',
        model: 'gpt-4o',
        toolPermission: { mode: 'denylist' as const, list: [] },
        skills: [],
        enabled: true,
      },
      {
        id: 'writer',
        description: 'Writes prose',
        systemPrompt: '',
        model: 'gpt-4o-mini',
        toolPermission: { mode: 'denylist' as const, list: [] },
        skills: [],
        enabled: true,
      },
    ];
    const result = buildRoleSection(roles);
    expect(result).toContain('**coder**');
    expect(result).toContain('**writer**');
    expect(result).toContain('Writes code');
    expect(result).toContain('Writes prose');
    // Roles listed in order
    expect(result.indexOf('**coder**')).toBeLessThan(result.indexOf('**writer**'));
  });

  it('builds role rules only for available delegation tools', () => {
    const roles = [
      {
        id: 'coder',
        description: 'Writes code',
        systemPrompt: '',
        model: 'gpt-4o',
        toolPermission: { mode: 'denylist' as const, list: [] },
        skills: [],
        enabled: true,
      },
    ];

    const result = buildRoleSection(roles, {
      canRunSubAgent: true,
      canRunTempSubAgent: false,
    });

    expect(result).toContain('run_sub_agent');
    expect(result).not.toContain('run_temp_sub_agent');
  });

  it('handles empty role array', () => {
    const result = buildRoleSection([]);
    expect(result).toContain('## 角色');
    expect(result).toContain('### 角色使用规则');
    // Rules contain **匹配** etc. but no role ID bullet entries
    expect(result).not.toContain('\n- **');
  });
});

describe('buildSkillSection', () => {
  const makeSkill = (name: string, description: string) => ({
    name,
    description,
    content: 'content',
    isSystem: true,
    filePath: `/skills/${name}.md`,
  });

  it('builds section with one skill', () => {
    const result = buildSkillSection([makeSkill('research', 'Deep research')]);
    expect(result).toContain('## 技能');
    expect(result).toContain('**research**');
    expect(result).toContain('Deep research');
    expect(result).toContain('### 技能使用规则');
  });

  it('uses fallback description when empty', () => {
    const result = buildSkillSection([makeSkill('test', '')]);
    expect(result).toContain('**test**');
    expect(result).toContain('无描述');
  });

  it('handles empty skills array', () => {
    const result = buildSkillSection([]);
    expect(result).toContain('## 技能');
    expect(result).toContain('### 可用技能');
    expect(result).toContain('### 技能使用规则');
  });

  it('formats multiple skills as separate items', () => {
    const result = buildSkillSection([
      makeSkill('skill-a', 'First'),
      makeSkill('skill-b', 'Second'),
    ]);
    // Check skill entries in the '可用技能' section
    const skillSection = result.split('### 可用技能')[1]?.split('### 技能使用规则')[0] ?? '';
    expect(skillSection).toContain('**skill-a**');
    expect(skillSection).toContain('**skill-b**');
    expect(skillSection).not.toContain('**skill-c**');
  });
});
