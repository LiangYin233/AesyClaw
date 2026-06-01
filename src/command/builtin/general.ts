import type { CommandRegistry } from '@aesyclaw/command/command-registry';
import { defineCommand } from '@aesyclaw/command/command-builder';
import { getMessageText, type CommandContext, type Message } from '@aesyclaw/core/types';
import { Agent } from '@aesyclaw/agent/agent';
import type { BuiltinCommandDependencies } from './types';

export function registerGeneralBuiltinCommands(
  registry: CommandRegistry,
  deps: BuiltinCommandDependencies,
): void {
  registry.register(
    defineCommand({
      name: 'help',
      description: '列出所有可用命令',
      scope: 'system',
      allowDuringAgentProcessing: true,
      execute: async (): Promise<Message> => {
        const commands = registry.getAll();

        if (commands.length === 0) {
          return { components: [{ type: 'Plain', text: '没有注册任何命令。' }] };
        }

        const lines: string[] = ['可用命令：\n'];
        for (const cmd of commands) {
          const usage = cmd.usage !== undefined ? ` - ${cmd.usage}` : '';
          const desc = cmd.description.length > 0 ? ` - ${cmd.description}` : '';
          lines.push(`  /${cmd.name}${usage}${desc}`);
        }

        return { components: [{ type: 'Plain', text: lines.join('\n') }] };
      },
    }),
  );

  registry.register(
    defineCommand({
      name: 'btw',
      description: '在当前会话上下文中执行一次独立提问',
      usage: '/btw <message>',
      scope: 'system',
      allowDuringAgentProcessing: true,
      execute: async (args: string[], context: CommandContext): Promise<Message> => {
        const content = args.join(' ').trim();
        if (content.length === 0) {
          return { components: [{ type: 'Plain', text: '用法：/btw <message>' }] };
        }

        const session = await deps.sessionManager.create(context.sessionKey);
        const activeRoleId = await Agent.resolveActiveRoleId(context, {
          databaseManager: deps.databaseManager,
          agentRegistry: deps.agentRegistry,
        });
        const role =
          activeRoleId !== undefined
            ? deps.roleManager.getRole(activeRoleId)
            : deps.roleManager.getDefaultRole();

        const dbRecord = await deps.databaseManager.sessions.findByKey(context.sessionKey);
        const modelId = dbRecord?.model_id;
        if (modelId === undefined) {
          return { components: [{ type: 'Plain', text: '当前会话没有可用模型。' }] };
        }

        const agent = deps.agentFactory.create(session, modelId);
        const outbound = await agent.process(
          { components: [{ type: 'Plain', text: content }] },
          undefined,
          { ephemeral: true, role },
        );

        return { components: [{ type: 'Plain', text: getMessageText(outbound) }] };
      },
    }),
  );

  registry.register(
    defineCommand({
      name: 'stop',
      description: '停止当前会话的 Agent 处理',
      scope: 'system',
      allowDuringAgentProcessing: true,
      execute: async (_args: string[], context: CommandContext): Promise<Message> => {
        const session = await deps.sessionManager.create(context.sessionKey);
        if (!session.isLocked) {
          return { components: [{ type: 'Plain', text: 'Agent 未在处理中。' }] };
        }

        const cancelled = deps.agentRegistry.cancel(context.sessionKey);
        if (!cancelled) {
          session.unlock();
        }
        return { components: [{ type: 'Plain', text: 'Agent 处理已停止。' }] };
      },
    }),
  );
}
