import type { RoleConfig } from '@aesyclaw/core/types';

export type BuildAgentPromptInput = {
  role: RoleConfig;
  promptSections: string[];
};

export function buildAgentPrompt(input: BuildAgentPromptInput): string {
  const { role, promptSections } = input;
  const sections: string[] = [replaceTemplateVariables(role.systemPrompt)];

  sections.push(...promptSections);

  return sections.join('\n\n');
}

function replaceTemplateVariables(template: string): string {
  return template
    .replace(/\{\{os}}/g, process.platform)
    .replace(/\{\{systemLang}}/g, process.env['LANG'] ?? 'unknown');
}
