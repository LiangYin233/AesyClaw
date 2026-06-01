import type { RoleConfig } from '@aesyclaw/core/types';
import type { AesyClawTool } from '@aesyclaw/tool/tool-registry';

export type BuildAgentPromptInput = {
  role: RoleConfig;
  availableTools: AesyClawTool[];
  promptSections: string[];
};

export function buildAgentPrompt(input: BuildAgentPromptInput): string {
  const { role, availableTools, promptSections } = input;
  const sections: string[] = [replaceTemplateVariables(role.systemPrompt)];

  if (availableTools.length > 0) {
    sections.push(buildToolSection(availableTools));
  }

  sections.push(...promptSections);

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
