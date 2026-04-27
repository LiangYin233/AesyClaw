import type { Skill } from '../core/types';

export function buildSkillPromptSection(skills: readonly Skill[]): string {
  if (skills.length === 0) {
    return '';
  }

  return skills.map((skill) => `## Skill: ${skill.name}\n${skill.content}`).join('\n\n');
}
