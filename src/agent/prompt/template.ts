import type { RoleConfig } from '@aesyclaw/core/types';
import type { AesyClawTool } from '@aesyclaw/tool/tool-registry';

export type BuildAgentPromptInput = {
  role: RoleConfig;
  availableTools: AesyClawTool[];
  promptSections: string[];
  finalPromptSections: string[];
  isSubAgent: boolean;
  isCron: boolean;
};

export function buildAgentPrompt(input: BuildAgentPromptInput): string {
  const { role, availableTools, promptSections, finalPromptSections, isSubAgent, isCron } = input;
  const sections: string[] = [replaceTemplateVariables(role.systemPrompt)];

  if (availableTools.length > 0) {
    sections.push(buildToolSection(availableTools));
  }

  sections.push(...promptSections);

  if (!isSubAgent && !isCron) {
    sections.push(
      [
        '## 用户沟通',
        '',
        '1. **主动通报** — 使用 `send_msg` 主动向用户通报当前进展。',
        '2. **禁止询问** — `send_msg` 仅用于单向通知，不要提问或征求确认。',
      ].join('\n'),
    );
  }

  sections.push(...finalPromptSections);

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
