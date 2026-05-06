import { Type } from '@sinclair/typebox';
import type {
  AesyClawTool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '@aesyclaw/tool/tool-registry';
import { errorMessage } from '@aesyclaw/core/utils';
import type { ToolOwner, SessionKey, Message } from '@aesyclaw/core/types';
import type { RoleConfig } from '@aesyclaw/core/types';
import type { RoleManager } from '@aesyclaw/role/role-manager';
import type { AgentMessage } from '@aesyclaw/agent/agent-types';
import { applyToolOverride } from './sub-agent-utils';

export function createRunSubAgentTool(deps: {
  roleManager: Pick<RoleManager, 'getRole'>;
  runTurn: (
    role: RoleConfig,
    content: string,
    history: AgentMessage[],
    sessionKey: SessionKey,
    sendMessage?: (message: Message) => Promise<boolean>,
  ) => Promise<{ newMessages: AgentMessage[]; lastAssistant: string | null }>;
}): AesyClawTool {
  return {
    name: 'run_sub_agent',
    description: '使用指定角色运行子代理',
    parameters: Type.Object({
      roleId: Type.String({ description: '要使用的角色 ID' }),
      prompt: Type.String({ description: '子代理的输入提示' }),
      enableTools: Type.Optional(Type.Boolean({ description: '是否允许子代理使用工具' })),
    }),
    owner: 'system' as ToolOwner,
    execute: async (
      params: unknown,
      context: ToolExecutionContext,
    ): Promise<ToolExecutionResult> => {
      const { roleId, prompt, enableTools } = params as {
        roleId: string;
        prompt: string;
        enableTools?: boolean;
      };

      try {
        const baseRole = deps.roleManager.getRole(roleId);
        const role = applyToolOverride(baseRole, enableTools);

        const result = await deps.runTurn(role, prompt, [], context.sessionKey);
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
