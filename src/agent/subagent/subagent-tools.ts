/** @file 子代理工具
 *
 * 提供 runSubAgent 和 runTempSubAgent 两个工具的实现，
 * 以及 createSubAgentTools 工厂函数。
 *
 * - runSubAgent：使用预定义角色创建子代理沙箱
 * - runTempSubAgent：使用临时系统提示词创建子代理沙箱
 *
 * 两个工具都通过 SandboxEngine 执行，SandboxEngine 提供隔离的执行环境
 * 并限制工具集以防止递归调用 subagent 工具。
 */

import { logger } from '@/platform/observability/logger.js';
import type { PluginHookRuntime } from '@/contracts/plugin-hook-runtime.js';
import type { ConfigSource, RoleStore, SkillStore } from '@/contracts/runtime-services.js';
import type { ToolCatalog } from '@/platform/tools/registry.js';
import {
    ToolExecuteContext,
    ToolExecutionResult,
    typeboxToToolParameters,
    validateToolArgs,
} from '@/platform/tools/types.js';
import { SandboxEngine } from './sandbox-engine.js';
import {
    RunSubAgentInputSchema,
    RunTempSubAgentInputSchema,
    SUBAGENT_TOOL_NAME_RUN,
    SUBAGENT_TOOL_NAME_TEMP,
    SUBAGENT_TOOL_DESCRIPTION_RUN,
    SUBAGENT_TOOL_DESCRIPTION_TEMP,
    type SubAgentResult,
} from './types.js';

interface SubAgentToolDeps {
    toolCatalog: ToolCatalog;
    hookRuntime: PluginHookRuntime;
    configSource: ConfigSource;
    roleStore: RoleStore;
    skillStore: SkillStore;
}

/** 使用预定义角色执行子代理任务 */
export async function runSubAgent(
    args: unknown,
    context: ToolExecuteContext,
    deps: SubAgentToolDeps,
): Promise<{ success: boolean; content: string; error?: string }> {
    const parsed = validateToolArgs<{ role_name: string; task_description: string }>(
        RunSubAgentInputSchema,
        args,
    );

    if (!parsed.success) {
        return {
            success: false,
            content: '',
            error: `参数错误: ${parsed.error}`,
        };
    }

    const { role_name, task_description } = parsed.data;

    logger.info({ roleName: role_name, taskDescription: task_description }, ' runSubAgent called');

    const role = deps.roleStore.getRole(role_name);
    if (!role) {
        const availableRoles = deps.roleStore.getRolesList();
        const roleList = availableRoles.map((r) => r.id).join(', ') || '无';
        return {
            success: false,
            content: '',
            error: `角色 "${role_name}" 不存在。\n\n可用角色: ${roleList}`,
        };
    }

    const systemPrompt = `${role.system_prompt}\n\n【任务】\n${task_description}`;
    const allowedTools = deps.roleStore.getAllowedTools(
        role_name,
        deps.toolCatalog.getAllToolDefinitions().map((tool) => tool.name),
    );

    const sandbox = new SandboxEngine(
        context.chatId,
        {
            roleId: role_name,
            systemPrompt,
            allowedTools,
            allowedSkills: role.allowed_skills,
            parentContext: context,
        },
        deps,
    );

    const result: SubAgentResult = await sandbox.execute();

    if (result.success) {
        return {
            success: true,
            content: formatSubAgentResult(role.name, result),
        };
    } else {
        return {
            success: false,
            content: '',
            error: `子代理执行失败: ${result.error}`,
        };
    }
}

/** 使用临时系统提示词执行子代理任务 */
export async function runTempSubAgent(
    args: unknown,
    context: ToolExecuteContext,
    deps: SubAgentToolDeps,
): Promise<{ success: boolean; content: string; error?: string }> {
    const parsed = validateToolArgs<{ system_prompt: string; task_description: string }>(
        RunTempSubAgentInputSchema,
        args,
    );

    if (!parsed.success) {
        return {
            success: false,
            content: '',
            error: `参数错误: ${parsed.error}`,
        };
    }

    const { system_prompt, task_description } = parsed.data;

    logger.info({ systemPromptPreview: system_prompt.substring(0, 50) }, ' runTempSubAgent called');

    const inheritedTools = Array.isArray(context.allowedTools)
        ? context.allowedTools.filter(
              (toolName): toolName is string => typeof toolName === 'string',
          )
        : ['*'];
    const inheritedSkills = Array.isArray(context.allowedSkills)
        ? context.allowedSkills.filter(
              (skillName): skillName is string => typeof skillName === 'string',
          )
        : [];

    const fullSystemPrompt = `${system_prompt}\n\n【任务】\n${task_description}`;

    const sandbox = new SandboxEngine(
        context.chatId,
        {
            roleId: undefined,
            systemPrompt: fullSystemPrompt,
            allowedTools: inheritedTools,
            allowedSkills: inheritedSkills,
            parentContext: context,
        },
        deps,
    );

    const result: SubAgentResult = await sandbox.execute();

    if (result.success) {
        return {
            success: true,
            content: formatSubAgentResult('临时专家', result),
        };
    } else {
        return {
            success: false,
            content: '',
            error: `临时分身执行失败: ${result.error}`,
        };
    }
}

/** 格式化子代理执行结果 */
function formatSubAgentResult(roleName: string, result: SubAgentResult): string {
    return `【${roleName}】执行报告
━━━━━━━━━━━━━━━━━━━━
${result.finalText}
━━━━━━━━━━━━━━━━━━━━
执行时间: ${result.executionTime}ms`;
}

/** 创建子代理工具定义 */
function createSubAgentTool(
    name: string,
    description: string,
    schema: typeof RunSubAgentInputSchema | typeof RunTempSubAgentInputSchema,
    executeFn: (_args: unknown, _context: ToolExecuteContext) => Promise<ToolExecutionResult>,
) {
    return {
        name,
        description,
        parametersSchema: schema,
        getDefinition: () => ({
            name,
            description,
            parameters: typeboxToToolParameters(schema),
        }),
        execute: executeFn,
    };
}

/** 创建子代理工具集合（runSubAgent + runTempSubAgent） */
export function createSubAgentTools(deps: SubAgentToolDeps) {
    return [
        createSubAgentTool(
            SUBAGENT_TOOL_NAME_RUN,
            SUBAGENT_TOOL_DESCRIPTION_RUN,
            RunSubAgentInputSchema,
            (args, context) => runSubAgent(args, context, deps),
        ),
        createSubAgentTool(
            SUBAGENT_TOOL_NAME_TEMP,
            SUBAGENT_TOOL_DESCRIPTION_TEMP,
            RunTempSubAgentInputSchema,
            (args, context) => runTempSubAgent(args, context, deps),
        ),
    ];
}
