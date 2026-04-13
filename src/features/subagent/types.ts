import { z } from 'zod';
import type { Message as AesyiuMessage } from 'aesyiu';
import type { ToolExecuteContext } from '../../platform/tools/types.js';

export const RunSubAgentInputSchema = z.object({
  role_name: z.string().describe('预定义角色名称，如 coder, translator 等'),
  task_description: z.string().describe('详细的任务描述'),
});

export type RunSubAgentInput = z.infer<typeof RunSubAgentInputSchema>;

export const RunTempSubAgentInputSchema = z.object({
  system_prompt: z.string().describe('临时分身的系统提示词'),
  task_description: z.string().describe('详细的任务描述'),
});

export type RunTempSubAgentInput = z.infer<typeof RunTempSubAgentInputSchema>;

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

export interface SandboxContext {
  sandboxId: string;
  parentChatId: string;
  config: SandboxConfig;
  messages: AesyiuMessage[];
  createdAt: Date;
}

export const SUBAGENT_TOOL_NAME_RUN = 'runSubAgent';
export const SUBAGENT_TOOL_NAME_TEMP = 'runTempSubAgent';
export const SUBAGENT_TOOL_DESCRIPTION_RUN = `加载 .aesyclaw/roles/ 中预定义的角色专家来执行专业任务。
使用场景：
- 需要代码编写、代码审查时使用 coder 角色
- 需要翻译时使用 translator 角色
- 需要数据分析时使用 analyst 角色
- 其他专业领域任务

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
