/**
 * prompt-builder — 构建发送给 LLM 的完整 Prompt。
 *
 * 从 Agent 类中提取，专注系统提示、工具列表、技能和角色信息的拼接。
 */

import type { Message, RoleConfig, SessionKey } from '@aesyclaw/core/types';
import type { AgentTool } from '@aesyclaw/contracts/llm';
import type { ToolExecutionContext } from '@aesyclaw/tool/tool-registry';
import type { ToolRegistry } from '@aesyclaw/tool/tool-registry';
import type { HookCtx, HookResult, IHooksBus } from '@aesyclaw/contracts/hook';
import { buildAgentPrompt } from './template';

export type PromptBuilderDeps = {
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
export async function buildPrompt(
  role: RoleConfig,
  executionContext: Partial<ToolExecutionContext> | undefined,
  deps: PromptBuilderDeps,
): Promise<BuildPromptResult> {
  const resolvedTools = deps.toolRegistry.resolveForRole(
    role,
    deps.hooksBus,
    executionContext ?? {},
  );
  const isSubAgent = executionContext !== undefined && executionContext.sendMessage === undefined;
  const isCron = executionContext?.sessionKey?.channel === 'cron';
  const promptSections: string[] = [];
  const promptCtx: HookCtx = {
    message: EMPTY_PROMPT_MESSAGE,
    sessionKey: executionContext?.sessionKey ?? createPromptSessionKey(role),
    role,
    promptSections,
    isSubAgent,
    isCron,
  };
  const hookResult = await deps.hooksBus.dispatch('prompt:build', promptCtx);
  assertPromptHookResult(hookResult);

  const prompt = buildAgentPrompt({
    role,
    promptSections,
  });

  return { prompt, tools: resolvedTools.agentTools };
}

const EMPTY_PROMPT_MESSAGE: Message = { components: [] };

function createPromptSessionKey(role: RoleConfig): SessionKey {
  return { channel: 'system', type: 'prompt', chatId: role.id };
}

function assertPromptHookResult(result: HookResult): void {
  if (result.action === 'next') return;
  if (result.action === 'error') {
    throw new Error(`prompt:build 钩子执行错误: ${result.reason}`);
  }
  throw new Error(`prompt:build 钩子返回了不支持的动作: ${result.action}`);
}
