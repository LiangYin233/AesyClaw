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
    sections.push(
      [
        '## 用户沟通',
        '',
        '### 规则',
        '',
        '1. **主动通报** — 任务执行时间较长（预计 >5 秒）时，必须先使用 `send_msg` 告知用户当前执行步骤。',
        '2. **每步通报** — 每个关键步骤完成后立即通报进展，不要等全部完成才一次性发送。',
        '3. **内容清晰** — 通报应包含：已完成什么、正在做什么、下一步计划（如有）。',
        '4. **禁止询问** — `send_msg` 仅用于单向通知，不要用它向用户提问或征求确认（用户无法通过此工具回复）。',
        '5. **附带 context** — 如果上一步产生了有意义的结果（搜索结果、代码输出等），在下一步开始时用 `send_msg` 简要总结。',
      ].join('\n'),
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
