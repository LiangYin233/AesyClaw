import type { Static } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';
import type {
  AesyClawTool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '@aesyclaw/tool/tool-registry';
import { errorMessage } from '@aesyclaw/core/utils';
import type { ToolOwner, SessionKey, OutboundMessage } from '@aesyclaw/core/types';
import type { RoleConfig } from '@aesyclaw/core/types';
import type { RoleManager } from '@aesyclaw/role/role-manager';
import type { AgentMessage } from '@aesyclaw/agent/agent-types';
import { applyToolOverride } from '@aesyclaw/agent/runner/sub-agent-utils';

const RunSubAgentParamsSchema = Type.Object({
  roleId: Type.String({ description: '要使用的角色 ID' }),
  prompt: Type.String({ description: '子代理的输入提示' }),
  enableTools: Type.Optional(Type.Boolean({ description: '是否允许子代理使用工具' })),
});

type RunSubAgentParams = Static<typeof RunSubAgentParamsSchema>;

type RunTurnFn = (
  role: RoleConfig,
  content: string,
  history: AgentMessage[],
  sessionKey: SessionKey,
  sendMessage?: (message: OutboundMessage) => Promise<boolean>,
) => Promise<{ newMessages: AgentMessage[]; lastAssistant: string | null }>;

export type RunSubAgentDeps = {
  roleManager: Pick<RoleManager, 'getRole'>;
  runTurn: RunTurnFn;
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

        const result = await deps.runTurn(
          role,
          prompt,
          [],
          context.sessionKey,
          context.sendMessage,
        );
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
