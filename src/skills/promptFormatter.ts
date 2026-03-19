export interface SkillPromptItem {
  name: string;
  description: string;
}

export function formatSkillsPrompt(skills: SkillPromptItem[]): string {
  if (skills.length === 0) {
    return '';
  }

  const skillsList = skills
    .map((skill) => `- ${skill.name}: ${skill.description || '无描述'}`)
    .join('\n');

  return [
    '可用 skills：',
    skillsList,
    '需要 skill 时：先用 read_skill 读 SKILL.md；需要更多文件时再用 list_skill_files。'
  ].join('\n');
}
