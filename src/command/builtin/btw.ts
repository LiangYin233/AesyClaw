import type { SessionManager } from '@aesyclaw/session';
import type { LlmAdapter } from '@aesyclaw/agent/llm/adapter';
import type { RoleManager } from '@aesyclaw/role/manager';
import type { SkillManager } from '@aesyclaw/skill/manager';
import type { ToolRegistry } from '@aesyclaw/tool/tool-registry';
import type { IHooksBus } from '@aesyclaw/hook';
import {
  getMessageText,
  type CommandContext,
  type CommandDefinition,
  type Message,
  type RoleConfig,
} from '@aesyclaw/core/types';
import type { DatabaseManager } from '@aesyclaw/core/database/database-manager';
import type { AgentRegistry } from '@aesyclaw/agent/registry';
import { Agent } from '@aesyclaw/agent/agent';

/**
 * 创建 /btw 命令，在当前会话上下文中执行一次独立的 LLM 提问。
 *
 * 与普通对话不同，/btw 的响应不写入会话历史。
 * @param sessionManager - 会话管理器（仅需 create 方法）
 * @param getRoleOrFallback - 按 ID 获取角色或返回回退角色
 * @param getDefaultRole - 获取默认角色
 * @param llmAdapter - LLM 适配器
 * @param roleManager - 角色管理器
 * @param skillManager - 技能管理器
 * @param toolRegistry - 工具注册表
 * @param hooksBus - Hook 总线
 * @param databaseManager - 数据库管理器（仅需 sessions）
 * @param compressionThreshold - 压缩阈值
 * @param agentRegistry - Agent 注册表
 * @param defaultModel - 默认模型 ID
 * @returns 命令定义
 */
export function createBtwCommand(
  sessionManager: Pick<SessionManager, 'create'>,
  getRoleOrFallback: (roleId: string) => RoleConfig,
  getDefaultRole: () => RoleConfig,
  llmAdapter: LlmAdapter,
  roleManager: RoleManager,
  skillManager: SkillManager,
  toolRegistry: ToolRegistry,
  hooksBus: IHooksBus,
  databaseManager: Pick<DatabaseManager, 'sessions'>,
  compressionThreshold: number,
  agentRegistry: AgentRegistry,
): CommandDefinition {
  return {
    name: 'btw',
    description: '在当前会话上下文中执行一次独立提问',
    usage: '/btw <message>',
    scope: 'system',
    allowDuringAgentProcessing: true,
    execute: async (args: string[], context: CommandContext): Promise<Message> => {
      const content = args.join(' ').trim();
      if (!content) {
        return { components: [{ type: 'Plain', text: '用法：/btw <message>' }] };
      }

      const session = await sessionManager.create(context.sessionKey);

      const activeRoleId = await Agent.resolveActiveRoleId(context, {
        databaseManager,
        agentRegistry,
      });
      const role = activeRoleId ? getRoleOrFallback(activeRoleId) : getDefaultRole();

      const dbRecord = await databaseManager.sessions.findByKey(context.sessionKey);
      const modelId = dbRecord!.model_id!;

      const agent = new Agent({
        session,
        llmAdapter,
        roleManager,
        skillManager,
        toolRegistry,
        hooksBus,
        compressionThreshold,
        registry: agentRegistry,
        defaultModel: modelId,
      });
      const outbound = await agent.process(
        { components: [{ type: 'Plain', text: content }] },
        undefined,
        { ephemeral: true, role },
      );

      return { components: [{ type: 'Plain', text: getMessageText(outbound) }] };
    },
  };
}
