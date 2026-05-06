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
import { applyToolOverride, createTempSubAgentRole } from './sub-agent-utils';

const RunTempSubAgentParamsSchema = Type.Object({
  systemPrompt: Type.String({ description: '子代理的系统提示' }),
  model: Type.Optional(Type.String({ description: '临时子代理使用的模型，格式为 provider/model' })),
  prompt: Type.String({ description: '子代理的输入提示' }),
  enableTools: Type.Optional(Type.Boolean({ description: '是否允许子代理使用工具' })),
});

type RunTempSubAgentParams = Static<typeof RunTempSubAgentParamsSchema>;

type RunTurnFn = (
  role: RoleConfig,
  content: string,
  history: AgentMessage[],
  sessionKey: SessionKey,
  sendMessage?: (message: OutboundMessage) => Promise<boolean>,
) => Promise<{ newMessages: AgentMessage[]; lastAssistant: string | null }>;

export type RunTempSubAgentDeps = {
  roleManager: Pick<RoleManager, 'getDefaultRole'>;
  runTurn: RunTurnFn;
};

export function createRunTempSubAgentTool(deps: RunTempSubAgentDeps): AesyClawTool {
  return {
    name: 'run_temp_sub_agent',
    description: '使用自定义系统提示运行临时子代理',
    parameters: RunTempSubAgentParamsSchema,
    owner: 'system' as ToolOwner,
    execute: async (
      params: unknown,
      context: ToolExecutionContext,
    ): Promise<ToolExecutionResult> => {
      const { systemPrompt, model, prompt, enableTools } = params as RunTempSubAgentParams;

      try {
        const baseRole = deps.roleManager.getDefaultRole();
        const roleWithPerms = createTempSubAgentRole(
          baseRole,
          { systemPrompt, model },
          context.toolPermission,
        );
        const role =
          enableTools === false ? applyToolOverride(roleWithPerms, false) : roleWithPerms;

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
          content: `临时子代理执行失败: ${errorMessage(error)}`,
          isError: true,
        };
      }
    },
  };
}
