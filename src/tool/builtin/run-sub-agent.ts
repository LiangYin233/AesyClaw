import { Type } from '@sinclair/typebox';
import { randomUUID } from 'node:crypto';
import type {
  AesyClawTool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '@aesyclaw/tool/tool-registry';
import { errorMessage } from '@aesyclaw/core/utils';
import type { ToolOwner, SessionKey, Message, RoleConfig } from '@aesyclaw/core/types';
import type { RoleManager } from '@aesyclaw/role/role-manager';
import type { AgentMessage } from '@aesyclaw/agent/agent-types';

const RUN_SUB_AGENT_SCHEMA = Type.Object({
  roleId: Type.String({ description: '要使用的角色 ID' }),
  prompt: Type.String({ description: '子代理的输入提示' }),
  enableTools: Type.Optional(Type.Boolean({ description: '是否允许子代理使用工具' })),
});

const RUN_TEMP_SUB_AGENT_SCHEMA = Type.Object({
  systemPrompt: Type.String({ description: '子代理的系统提示' }),
  model: Type.Optional(Type.String({ description: '临时子代理使用的模型，格式为 provider/model' })),
  prompt: Type.String({ description: '子代理的输入提示' }),
  enableTools: Type.Optional(Type.Boolean({ description: '是否允许子代理使用工具' })),
});

export function createRunSubAgentTool(deps: {
  roleManager: Pick<RoleManager, 'getRole'>;
  callLLM: (
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
    parameters: RUN_SUB_AGENT_SCHEMA,
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

        const result = await deps.callLLM(role, prompt, [], context.sessionKey);
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

export function createRunTempSubAgentTool(deps: {
  roleManager: Pick<RoleManager, 'getDefaultRole'>;
  callLLM: (
    role: RoleConfig,
    content: string,
    history: AgentMessage[],
    sessionKey: SessionKey,
    sendMessage?: (message: Message) => Promise<boolean>,
  ) => Promise<{ newMessages: AgentMessage[]; lastAssistant: string | null }>;
}): AesyClawTool {
  return {
    name: 'run_temp_sub_agent',
    description: '使用自定义系统提示运行临时子代理',
    parameters: RUN_TEMP_SUB_AGENT_SCHEMA,
    owner: 'system' as ToolOwner,
    execute: async (
      params: unknown,
      context: ToolExecutionContext,
    ): Promise<ToolExecutionResult> => {
      const { systemPrompt, model, prompt, enableTools } = params as {
        systemPrompt: string;
        model?: string;
        prompt: string;
        enableTools?: boolean;
      };

      try {
        const baseRole = deps.roleManager.getDefaultRole();
        const roleWithPerms = createTempSubAgentRole(
          baseRole,
          { systemPrompt, model },
          context.toolPermission,
        );
        const role =
          enableTools === false ? applyToolOverride(roleWithPerms, false) : roleWithPerms;

        const result = await deps.callLLM(role, prompt, [], context.sessionKey);
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

// ─── 内部辅助 ──────────────────────────────────────────────────────

const BLOCKED_TOOLS = ['run_sub_agent', 'run_temp_sub_agent', 'send_msg'];

function applyToolOverride(role: RoleConfig, enableTools?: boolean): RoleConfig {
  if (enableTools === false) {
    return { ...role, toolPermission: { mode: 'allowlist', list: [] } };
  }

  const { mode, list } = role.toolPermission;

  if (mode === 'allowlist') {
    return list.includes('*')
      ? { ...role, toolPermission: { mode: 'denylist' as const, list: BLOCKED_TOOLS } }
      : {
          ...role,
          toolPermission: {
            mode: 'allowlist' as const,
            list: list.filter((name) => !BLOCKED_TOOLS.includes(name)),
          },
        };
  }

  return {
    ...role,
    toolPermission: {
      mode: 'denylist' as const,
      list: [...new Set([...list, ...BLOCKED_TOOLS])],
    },
  };
}

function createTempSubAgentRole(
  baseRole: RoleConfig,
  params: { systemPrompt: string; model?: string },
  toolPermission?: RoleConfig['toolPermission'],
): RoleConfig {
  return {
    ...baseRole,
    toolPermission: toolPermission ?? baseRole.toolPermission,
    id: `temp-sub-agent-${randomUUID()}`,
    description: 'Temporary delegated agent execution',
    systemPrompt: params.systemPrompt,
    model: params.model ?? baseRole.model,
    enabled: true,
  };
}
