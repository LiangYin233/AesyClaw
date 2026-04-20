import { z } from 'zod';
import type { ToolExecuteContext } from '@/platform/tools/types.js';

export const RunSubAgentInputSchema = z.object({
    role_name: z.string().describe('预定义角色名称，必须是当前已存在的角色 ID'),
    task_description: z.string().describe('详细的任务描述'),
});

export const RunTempSubAgentInputSchema = z.object({
    system_prompt: z.string().describe('临时分身的系统提示词'),
    task_description: z.string().describe('详细的任务描述'),
});

export interface SubAgentResult {
    success: boolean;
    finalText: string;
    roleId: string;
    executionTime: number;
    error?: string;
}

export interface SandboxConfig {
    roleId?: string;
    systemPrompt: string;
    allowedTools: string[];
    allowedSkills: string[];
    parentContext?: ToolExecuteContext;
}

export const SUBAGENT_TOOL_NAME_RUN = 'runSubAgent';
export const SUBAGENT_TOOL_NAME_TEMP = 'runTempSubAgent';
export const SUBAGENT_TOOL_DESCRIPTION_RUN = `加载预定义的角色专家来执行专业任务。
使用场景：
- 当任务适合交给某个已存在的预定义角色处理时使用
- 其他需要专业分工的任务

参数：
- role_name: 角色名称（必须是已存在的角色）
- task_description: 详细的任务描述`;

export const SUBAGENT_TOOL_DESCRIPTION_TEMP = `创建临时的专业分身来执行任务。
使用场景：
- 主 Agent 遇到冷门任务，需要临时专家
- 一次性任务不需要持久化角色
- 快速原型验证

特点：
- 自动继承父级 Agent 的工具和技能权限
- 沙箱隔离，不影响主会话上下文
- 执行完毕后自动销毁

参数：
- system_prompt: 为分身编写的系统提示词
- task_description: 详细的任务描述`;
