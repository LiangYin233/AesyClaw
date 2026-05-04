/**
 * 内置 run_sub_agent 工具。
 *
 * 使用指定的角色 ID 和提示运行委托子代理轮次。
 */

import type { Static } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';
import type {
  AesyClawTool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '@aesyclaw/tool/tool-registry';
import { errorMessage } from '@aesyclaw/core/utils';
import type { ToolOwner } from '@aesyclaw/core/types';
import type { AgentEngine } from '@aesyclaw/agent/agent-engine';
import type { RoleManager } from '@aesyclaw/role/role-manager';
import { applyToolOverride } from '@aesyclaw/agent/runner/sub-agent-utils';

const RunSubAgentParamsSchema = Type.Object({
  roleId: Type.String({ description: '要使用的角色 ID' }),
  prompt: Type.String({ description: '子代理的输入提示' }),
  enableTools: Type.Optional(Type.Boolean({ description: '是否允许子代理使用工具' })),
});

type RunSubAgentParams = Static<typeof RunSubAgentParamsSchema>;

export type RunSubAgentDeps = {
  agentEngine: Pick<AgentEngine, 'runAgentTurn'>;
  roleManager: Pick<RoleManager, 'getRole'>;
};

export function createRunSubAgentTool(deps: RunSubAgentDeps): AesyClawTool {
  return {
    name: 'run_sub_agent',
    description: '使用指定角色运行子代理',
    parameters: RunSubAgentParamsSchema,
    owner: 'system' as ToolOwner,
    execute: async (
      params: unknown,
      context: ToolExecutionContext,
    ): Promise<ToolExecutionResult> => {
      const { roleId, prompt, enableTools } = params as RunSubAgentParams;

      try {
        const baseRole = deps.roleManager.getRole(roleId);
        const role = applyToolOverride(baseRole, enableTools);
        const result = await deps.agentEngine.runAgentTurn({
          role,
          content: prompt,
          history: [],
          sessionKey: context.sessionKey,
          sendMessage: context.sendMessage,
        });
        return { content: result.lastAssistant ?? '[子 Agent 无输出]' };
      } catch (error: unknown) {
        return {
          content: `子代理执行失败: ${errorMessage(error)}`,
          isError: true,
        };
      }
    },
  };
}
