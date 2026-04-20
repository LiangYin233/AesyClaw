/** @file 插件钩子工具函数
 *
 * 提供将内部工具/技能定义转换为钩子载荷格式的工具函数，
 * 供 beforeLLMRequest 钩子使用。
 */

import type { AgentSkill } from 'aesyiu';
import type { ToolDefinition } from '@/platform/tools/types.js';
import type { HookPayloadLLMSkill, HookPayloadLLMTool } from './types.js';

/** 当存在可用技能时，自动注入的 loadskill 工具定义 */
const LOAD_SKILL_TOOL: HookPayloadLLMTool = {
    name: 'loadskill',
    description:
        'Load the full content for an available skill by name when the system prompt lists a relevant skill.',
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

/** 将 AgentSkill 数组转换为钩子可用的技能描述列表 */
export function buildHookSkills(skills: readonly AgentSkill[]): HookPayloadLLMSkill[] {
    return skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        metadata: skill.metadata as Record<string, unknown>,
    }));
}

/** 将 ToolDefinition 数组转换为钩子可用的工具描述列表
 *
 * 当 skills 非空时，额外追加 loadskill 工具，使 LLM 可以按需加载技能内容。
 */
export function buildHookTools(
    toolDefinitions: readonly ToolDefinition[],
    skills: readonly AgentSkill[],
): HookPayloadLLMTool[] {
    const tools = toolDefinitions.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters as Record<string, unknown>,
    }));

    if (skills.length > 0) {
        tools.push(LOAD_SKILL_TOOL);
    }

    return tools;
}
