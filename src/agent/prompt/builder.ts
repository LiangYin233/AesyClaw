/**
 * prompt-builder — 构建发送给 LLM 的完整 Prompt。
 *
 * 从 Agent 类中提取，专注系统提示、工具列表、技能和角色信息的拼接。
 */

import type { RoleConfig } from '@aesyclaw/core/types';
import type { AgentTool } from '@aesyclaw/contracts/llm';
import type { ToolExecutionContext } from '@aesyclaw/tool/tool-registry';
import type { SkillManager } from '@aesyclaw/skill/manager';
import type { ToolRegistry } from '@aesyclaw/tool/tool-registry';
import type { RoleManager } from '@aesyclaw/role/manager';
import type { IHooksBus } from '@aesyclaw/contracts/hook';
import { buildAgentPrompt } from './template';

export type PromptBuilderDeps = {
  roleManager: RoleManager;
  skillManager: SkillManager;
  toolRegistry: ToolRegistry;
  hooksBus: IHooksBus;
};

export type BuildPromptResult = {
  prompt: string;
  tools: AgentTool[];
};

/**
 * 构建发送给 LLM 的完整 Prompt。
 */
export function buildPrompt(
  role: RoleConfig,
  executionContext: Partial<ToolExecutionContext> | undefined,
  deps: PromptBuilderDeps,
): BuildPromptResult {
  const allRoles = deps.roleManager.getEnabledRoles();
  const skills = deps.skillManager.getSkillsForRole(role);
  const resolvedTools = deps.toolRegistry.resolveForRole(
    role,
    deps.hooksBus,
    executionContext ?? {},
  );
  const prompt = buildAgentPrompt({
    role,
    availableTools: resolvedTools.tools,
    skills,
    allRoles,
    skillDirs: deps.skillManager.getSkillDirs(),
    isSubAgent: executionContext !== undefined && executionContext.sendMessage === undefined,
    isCron: executionContext?.sessionKey?.channel === 'cron',
  });

  return { prompt, tools: resolvedTools.agentTools };
}
