import type { CommandRegistry } from '@aesyclaw/command/command-registry';
import type { SessionManager } from '@aesyclaw/session';
import type { RoleManager } from '@aesyclaw/role/manager';
import type { LlmAdapter } from '@aesyclaw/agent/llm/adapter';
import type { SkillManager } from '@aesyclaw/skill/manager';
import type { ToolRegistry } from '@aesyclaw/tool/tool-registry';
import type { IHooksBus } from '@aesyclaw/hook';
import type { PluginManager } from '@aesyclaw/extension/plugin/manager';
import type { DatabaseManager } from '@aesyclaw/core/database/database-manager';
import type { AgentRegistry } from '@aesyclaw/agent/registry';
import type { AgentFactory } from '@aesyclaw/agent/agent-factory';
import {
  getMessageText,
  type CommandContext,
  type CommandDefinition,
  type Message,
} from '@aesyclaw/core/types';
import { Agent } from '@aesyclaw/agent/agent';
import { CommandBuilder } from '@aesyclaw/command/command-builder';

/** 注册内置命令所需的完整依赖集合。 */
export type BuiltinCommandDependencies = {
  roleManager: RoleManager;
  pluginManager: Pick<PluginManager, 'listPlugins' | 'enable' | 'disable'>;
  sessionManager: Pick<SessionManager, 'create' | 'clearById' | 'deleteById' | 'get'>;
  llmAdapter: LlmAdapter;
  skillManager: SkillManager;
  toolRegistry: ToolRegistry;
  hooksBus: IHooksBus;
  databaseManager: Pick<DatabaseManager, 'sessions'>;
  compressionThreshold: number;
  agentRegistry: AgentRegistry;
  agentFactory: AgentFactory;
};

/**
 * 向命令注册表中注册所有内置命令。
 * @param registry - 命令注册表
 * @param deps - 内置命令所需的依赖集合
 */
export function registerBuiltinCommands(
  registry: CommandRegistry,
  deps: BuiltinCommandDependencies,
): void {
  // ── /help ──────────────────────────────────────────────
  const helpCommand = new CommandBuilder()
    .setName('help')
    .setDescription('列出所有可用命令')
    .setScope('system')
    .allowDuringAgentProcessing(true)
    .setExecutor(async (): Promise<Message> => {
      const commands = registry.getAll();

      if (commands.length === 0) {
        return { components: [{ type: 'Plain', text: '没有注册任何命令。' }] };
      }

      const lines: string[] = [];
      lines.push('可用命令：\n');

      for (const cmd of commands) {
        const usage = cmd.usage ? ` - ${cmd.usage}` : '';
        const desc = cmd.description ? ` - ${cmd.description}` : '';
        lines.push(`  /${cmd.name}${usage}${desc}`);
      }

      return { components: [{ type: 'Plain', text: lines.join('\n') }] };
    })
    .build();

  registry.register(helpCommand);

  // ── /btw ───────────────────────────────────────────────
  const btwCommand = new CommandBuilder()
    .setName('btw')
    .setDescription('在当前会话上下文中执行一次独立提问')
    .setUsage('/btw <message>')
    .setScope('system')
    .allowDuringAgentProcessing(true)
    .setExecutor(async (args: string[], context: CommandContext): Promise<Message> => {
      const content = args.join(' ').trim();
      if (!content) {
        return { components: [{ type: 'Plain', text: '用法：/btw <message>' }] };
      }

      const session = await deps.sessionManager.create(context.sessionKey);

      const activeRoleId = await Agent.resolveActiveRoleId(context, {
        databaseManager: deps.databaseManager,
        agentRegistry: deps.agentRegistry,
      });
      const role = activeRoleId
        ? deps.roleManager.getRole(activeRoleId)
        : deps.roleManager.getDefaultRole();

      const dbRecord = await deps.databaseManager.sessions.findByKey(context.sessionKey);
      const modelId = dbRecord!.model_id!;

      const agent = deps.agentFactory.create(session, modelId);
      const outbound = await agent.process(
        { components: [{ type: 'Plain', text: content }] },
        undefined,
        { ephemeral: true, role },
      );

      return { components: [{ type: 'Plain', text: getMessageText(outbound) }] };
    })
    .build();

  registry.register(btwCommand);

  // ── /model ─────────────────────────────────────────────
  const modelCommand = new CommandBuilder()
    .setName('model')
    .setDescription('查看或切换当前会话的模型')
    .setUsage('/model [provider/model]')
    .setScope('system')
    .allowDuringAgentProcessing(true)
    .setExecutor(async (args: string[], context: CommandContext): Promise<Message> => {
      const newModelId = args.join(' ').trim();

      if (!newModelId) {
        // 查看当前模型
        const agent = deps.agentRegistry.getAgent(context.sessionKey);
        if (agent) {
          return {
            components: [{ type: 'Plain', text: `当前模型：${agent.modelIdentifier}` }],
          };
        }
        const dbRecord = await deps.databaseManager.sessions.findByKey(context.sessionKey);
        const currentModel = dbRecord?.model_id ?? '未知';
        return { components: [{ type: 'Plain', text: `当前模型：${currentModel}` }] };
      }

      // 切换模型
      try {
        deps.llmAdapter.resolveModel(newModelId);
      } catch (err) {
        return {
          components: [
            {
              type: 'Plain',
              text: `无效的模型标识符：${newModelId}\n${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }

      const dbRecord = await deps.databaseManager.sessions.findByKey(context.sessionKey);
      if (dbRecord) {
        await deps.databaseManager.sessions.setModel(dbRecord.id, newModelId);
      }

      const agent = deps.agentRegistry.getAgent(context.sessionKey);
      if (agent) {
        agent.setModel(newModelId);
      }

      return { components: [{ type: 'Plain', text: `已切换到模型：${newModelId}` }] };
    })
    .build();

  registry.register(modelCommand);

  // ── /clear ─────────────────────────────────────────────
  const clearCommand = new CommandBuilder()
    .setName('clear')
    .setDescription('清空当前会话的历史记录')
    .setScope('system')
    .allowDuringAgentProcessing(false)
    .setExecutor(async (_args: string[], context: CommandContext): Promise<Message> => {
      const agent = deps.agentRegistry.getAgent(context.sessionKey);
      if (agent?.session.isLocked) {
        return {
          components: [{ type: 'Plain', text: 'Agent 正在处理中，无法清空会话。' }],
        };
      }

      const dbRecord = await deps.databaseManager.sessions.findByKey(context.sessionKey);
      if (dbRecord) {
        await deps.sessionManager.clearById(dbRecord.id);
      }
      return { components: [{ type: 'Plain', text: '会话历史已清空。' }] };
    })
    .build();

  registry.register(clearCommand);

  // ── /compact ───────────────────────────────────────────
  const compactCommand = new CommandBuilder()
    .setName('compact')
    .setDescription('压缩当前会话的历史记录')
    .setScope('system')
    .allowDuringAgentProcessing(false)
    .setExecutor(async (_args: string[], context: CommandContext): Promise<Message> => {
      const session = await deps.sessionManager.create(context.sessionKey);
      const dbRecord = await deps.databaseManager.sessions.findByKey(context.sessionKey);
      const modelId = dbRecord!.model_id!;

      const summary = await session.compact(deps.llmAdapter, modelId);
      return {
        components: [{ type: 'Plain', text: `会话已压缩。\n\n摘要：\n${summary}` }],
      };
    })
    .build();

  registry.register(compactCommand);

  // ── /stop ──────────────────────────────────────────────
  const stopCommand = new CommandBuilder()
    .setName('stop')
    .setDescription('停止当前会话的 Agent 处理')
    .setScope('system')
    .allowDuringAgentProcessing(true)
    .setExecutor(async (_args: string[], context: CommandContext): Promise<Message> => {
      const session = await deps.sessionManager.create(context.sessionKey);
      if (!session.isLocked) {
        return { components: [{ type: 'Plain', text: 'Agent 未在处理中。' }] };
      }

      session.unlock();
      return { components: [{ type: 'Plain', text: 'Agent 处理已停止。' }] };
    })
    .build();

  registry.register(stopCommand);

  // ── /role:list ─────────────────────────────────────────
  const roleListCommand = new CommandBuilder()
    .setName('list')
    .setNamespace('role')
    .setDescription('列出所有可用角色')
    .setScope('system')
    .allowDuringAgentProcessing(true)
    .setExecutor(async (): Promise<Message> => {
      const roles = deps.roleManager.getAllRoles();
      if (roles.length === 0) {
        return { components: [{ type: 'Plain', text: '没有可用的角色。' }] };
      }

      const lines = ['可用角色：\n'];
      for (const role of roles) {
        const isDefault = role.id === deps.roleManager.getDefaultRole().id;
        const marker = isDefault ? ' (默认)' : '';
        lines.push(`  ${role.id}${marker} - ${role.description}`);
      }

      return { components: [{ type: 'Plain', text: lines.join('\n') }] };
    })
    .build();

  registry.register(roleListCommand);

  // ── /role:switch ───────────────────────────────────────
  const roleSwitchCommand = new CommandBuilder()
    .setName('switch')
    .setNamespace('role')
    .setDescription('切换当前会话的角色')
    .setUsage('/role:switch <role-id>')
    .setScope('system')
    .allowDuringAgentProcessing(false)
    .setExecutor(async (args: string[], context: CommandContext): Promise<Message> => {
      const roleId = args.join(' ').trim();
      if (!roleId) {
        return { components: [{ type: 'Plain', text: '用法：/role:switch <role-id>' }] };
      }

      const role = deps.roleManager.getRole(roleId);
      if (!role) {
        return { components: [{ type: 'Plain', text: `角色不存在：${roleId}` }] };
      }

      const dbRecord = await deps.databaseManager.sessions.findByKey(context.sessionKey);
      if (!dbRecord) {
        return { components: [{ type: 'Plain', text: '会话不存在' }] };
      }
      await deps.databaseManager.sessions.setRole(dbRecord.id, roleId);

      const agent = deps.agentRegistry.getAgent(context.sessionKey);
      if (agent) {
        await agent.setRole(role);
      }

      return { components: [{ type: 'Plain', text: `已切换到角色：${role.id}` }] };
    })
    .build();

  registry.register(roleSwitchCommand);

  // ── /role:info ─────────────────────────────────────────
  const roleInfoCommand = new CommandBuilder()
    .setName('info')
    .setNamespace('role')
    .setDescription('查看当前会话的角色信息')
    .setScope('system')
    .allowDuringAgentProcessing(true)
    .setExecutor(async (_args: string[], context: CommandContext): Promise<Message> => {
      const activeRoleId = await Agent.resolveActiveRoleId(context, {
        databaseManager: deps.databaseManager,
        agentRegistry: deps.agentRegistry,
      });
      const role = activeRoleId
        ? deps.roleManager.getRole(activeRoleId)
        : deps.roleManager.getDefaultRole();

      const lines = [
        `当前角色：${role.id}`,
        role.description ? `描述：${role.description}` : '',
      ].filter(Boolean);

      return { components: [{ type: 'Plain', text: lines.join('\n') }] };
    })
    .build();

  registry.register(roleInfoCommand);

  // ── /plugin:list ───────────────────────────────────────
  const pluginListCommand = new CommandBuilder()
    .setName('list')
    .setNamespace('plugin')
    .setDescription('列出所有插件')
    .setScope('system')
    .allowDuringAgentProcessing(true)
    .setExecutor(async (): Promise<Message> => {
      const plugins = await deps.pluginManager.listPlugins();
      if (plugins.length === 0) {
        return { components: [{ type: 'Plain', text: '没有可用的插件。' }] };
      }

      const lines = ['可用插件：\n'];
      for (const plugin of plugins) {
        const status = plugin.state === 'loaded' ? '✓' : plugin.state === 'failed' ? '✗' : '○';
        const enabled = plugin.enabled ? '启用' : '禁用';
        lines.push(`  [${status}] ${plugin.name} - ${enabled}`);
      }

      return { components: [{ type: 'Plain', text: lines.join('\n') }] };
    })
    .build();

  registry.register(pluginListCommand);

  // ── /plugin:enable ─────────────────────────────────────
  const pluginEnableCommand = new CommandBuilder()
    .setName('enable')
    .setNamespace('plugin')
    .setDescription('启用指定插件')
    .setUsage('/plugin:enable <plugin-name>')
    .setScope('system')
    .allowDuringAgentProcessing(true)
    .setExecutor(async (args: string[]): Promise<Message> => {
      const pluginName = args.join(' ').trim();
      if (!pluginName) {
        return { components: [{ type: 'Plain', text: '用法：/plugin:enable <plugin-name>' }] };
      }

      try {
        await deps.pluginManager.enable(pluginName);
        return { components: [{ type: 'Plain', text: `插件 ${pluginName} 已启用。` }] };
      } catch (err) {
        return {
          components: [
            {
              type: 'Plain',
              text: `启用插件失败：${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }
    })
    .build();

  registry.register(pluginEnableCommand);

  // ── /plugin:disable ────────────────────────────────────
  const pluginDisableCommand = new CommandBuilder()
    .setName('disable')
    .setNamespace('plugin')
    .setDescription('禁用指定插件')
    .setUsage('/plugin:disable <plugin-name>')
    .setScope('system')
    .allowDuringAgentProcessing(true)
    .setExecutor(async (args: string[]): Promise<Message> => {
      const pluginName = args.join(' ').trim();
      if (!pluginName) {
        return { components: [{ type: 'Plain', text: '用法：/plugin:disable <plugin-name>' }] };
      }

      try {
        await deps.pluginManager.disable(pluginName);
        return { components: [{ type: 'Plain', text: `插件 ${pluginName} 已禁用。` }] };
      } catch (err) {
        return {
          components: [
            {
              type: 'Plain',
              text: `禁用插件失败：${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }
    })
    .build();

  registry.register(pluginDisableCommand);

  // ── /skill:reload ──────────────────────────────────────
  const skillReloadCommand = new CommandBuilder()
    .setName('reload')
    .setNamespace('skill')
    .setDescription('重新加载所有技能')
    .setScope('system')
    .allowDuringAgentProcessing(false)
    .setExecutor(async (): Promise<Message> => {
      try {
        await deps.skillManager.reload();

        // 使当前 Agent 的 prompt 缓存失效（如果存在）
        // AgentRegistry 没有 getAllAgents 方法，只能在下次创建 Agent 时自动加载新技能

        return { components: [{ type: 'Plain', text: '技能已重新加载。' }] };
      } catch (err) {
        return {
          components: [
            {
              type: 'Plain',
              text: `重新加载技能失败：${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }
    })
    .build();

  registry.register(skillReloadCommand);
}
