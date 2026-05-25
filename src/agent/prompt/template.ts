import type { RoleConfig, Skill } from '@aesyclaw/core/types';
import type { AesyClawTool } from '@aesyclaw/tool/tool-registry';
import { buildRoleSection, buildSkillSection } from './sections';

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
    sections.push([
      '## 用户沟通',
      '',
      '1. **主动通报** — 每完成一个关键步骤，立即使用 `send_msg` 告知用户当前进展。',
      '2. **禁止询问** — `send_msg` 仅用于单向通知，不要提问或征求确认。',
    ].join('\n'));
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
