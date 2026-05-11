import type { RoleConfig, Skill } from '@aesyclaw/core/types';
import type { AesyClawTool } from '@aesyclaw/tool/tool-registry';
import { buildRoleSection, buildSkillSection } from './prompt-sections';

export type BuildAgentPromptInput = {
  role: RoleConfig;
  availableTools: AesyClawTool[];
  skills: Skill[];
  allRoles: RoleConfig[];
  skillDirs: Record<string, string>;
  isSubAgent: boolean;
  isCron: boolean;
};

export function buildAgentPrompt(input: BuildAgentPromptInput): string {
  const { role, availableTools, skills, allRoles, skillDirs, isSubAgent, isCron } = input;
  const sections: string[] = [replaceTemplateVariables(role.systemPrompt)];

  if (availableTools.length > 0) {
    sections.push(buildToolSection(availableTools));
  }

  if (skills.length > 0) {
    sections.push(buildSkillSection(skills, skillDirs));
  }

  if (!isSubAgent && !isCron) {
    sections.push(
      '## 用户沟通\n在任务执行过程中，如果需要向用户说明当前正在进行的步骤或进度，可使用 send_msg 工具发送消息给用户。',
    );
  }

  if (allRoles.length > 0 && !isSubAgent) {
    sections.push(buildRoleSection(allRoles));
  }

  return sections.join('\n\n');
}

function replaceTemplateVariables(template: string): string {
  return template
    .replace(/\{\{os}}/g, process.platform)
    .replace(/\{\{systemLang}}/g, process.env['LANG'] ?? 'unknown');
}

function buildToolSection(tools: AesyClawTool[]): string {
  const toolLines = tools.map((tool) => `- **${tool.name}**: ${tool.description}`);
  return `## Available Tools\n${toolLines.join('\n')}`;
}
