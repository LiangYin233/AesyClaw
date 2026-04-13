import type { AgentSkill } from 'aesyiu';
import type { ToolDefinition } from '@/platform/tools/types.js';
import type { HookPayloadLLMSkill, HookPayloadLLMTool } from './types.js';

const LOAD_SKILL_TOOL: HookPayloadLLMTool = {
  name: 'loadskill',
  description: 'Load the full content for an available skill by name when the system prompt lists a relevant skill.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'The skill name to load.',
      },
    },
    required: ['name'],
  },
};

export function buildHookSkills(skills: readonly AgentSkill[]): HookPayloadLLMSkill[] {
  return skills.map(skill => ({
    name: skill.name,
    description: skill.description,
    metadata: skill.metadata as Record<string, unknown>,
  }));
}

export function buildHookTools(
  toolDefinitions: readonly ToolDefinition[],
  skills: readonly AgentSkill[]
): HookPayloadLLMTool[] {
  const tools = toolDefinitions.map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters as Record<string, unknown>,
  }));

  if (skills.length > 0) {
    tools.push(LOAD_SKILL_TOOL);
  }

  return tools;
}
