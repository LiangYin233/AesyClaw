import type { SessionManager } from '@aesyclaw/session';
import type { LlmAdapter } from '@aesyclaw/agent/llm-adapter';
import type { RoleManager } from '@aesyclaw/role/role-manager';
import type { SkillManager } from '@aesyclaw/skill/skill-manager';
import type { ToolRegistry } from '@aesyclaw/tool/tool-registry';
import type { HookDispatcher } from '@aesyclaw/pipeline/hook-dispatcher';
import type { CommandContext, CommandDefinition, RoleConfig } from '@aesyclaw/core/types';
import { getMessageText } from '@aesyclaw/core/types';
import type { DatabaseManager } from '@aesyclaw/core/database/database-manager';
import type { AgentRegistry } from '@aesyclaw/agent/agent-registry';
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
 * @param hookDispatcher - 钩子派发器
 * @param databaseManager - 数据库管理器（仅需 roleBindings 和 sessions）
 * @param compressionThreshold - 压缩阈值
 * @param agentRegistry - Agent 注册表
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
  hookDispatcher: HookDispatcher,
  databaseManager: Pick<DatabaseManager, 'roleBindings' | 'sessions'>,
  compressionThreshold: number,
  agentRegistry: AgentRegistry,
): CommandDefinition {
  return {
    name: 'btw',
    description: '在当前会话上下文中执行一次独立提问',
    usage: '/btw <message>',
    scope: 'system',
    allowDuringAgentProcessing: true,
    execute: async (args: string[], context: CommandContext): Promise<string> => {
      const content = args.join(' ').trim();
      if (!content) {
        return '用法：/btw <message>';
      }

      const session = await sessionManager.create(context.sessionKey);

      const activeRoleId = await Agent.resolveActiveRoleId(context, {
        databaseManager,
        agentRegistry,
      });
      const role = activeRoleId ? getRoleOrFallback(activeRoleId) : getDefaultRole();

      const agent = new Agent({
        session,
        llmAdapter,
        roleManager,
        skillManager,
        toolRegistry,
        hookDispatcher,
        compressionThreshold,
        registry: agentRegistry,
      });
      const outbound = await agent.process(
        { components: [{ type: 'Plain', text: content }] },
        undefined,
        { ephemeral: true, role },
      );

      return getMessageText(outbound);
    },
  };
}
