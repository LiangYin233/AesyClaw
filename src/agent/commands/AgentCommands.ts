import type { InboundMessage } from '../../types.js';
import type { SessionManager } from '../../session/SessionManager.js';
import type { AgentRoleService } from '../roles/AgentRoleService.js';
import { CommandHandler, type CommandDefinition } from './CommandHandler.js';

export class AgentCommands extends CommandHandler {
  constructor(
    private sessionManager: SessionManager,
    private agentRoleService: AgentRoleService
  ) {
    super();
  }

  getCommands(): CommandDefinition[] {
    return [
      {
        name: 'agent-list',
        description: '列出可用 Agent 角色',
        matcher: { type: 'exact', value: '/agent list' },
        handler: this.handleList.bind(this)
      },
      {
        name: 'agent-current',
        description: '查看当前 Agent 角色',
        matcher: { type: 'exact', value: '/agent current' },
        handler: this.handleCurrent.bind(this)
      },
      {
        name: 'agent-use',
        description: '切换当前会话 Agent 角色',
        matcher: { type: 'regex', value: /^\/agent\s+use\s+([\w-]+)$/ },
        handler: this.handleUse.bind(this)
      },
      {
        name: 'agent-reset',
        description: '重置当前会话 Agent 角色',
        matcher: { type: 'exact', value: '/agent reset' },
        handler: this.handleReset.bind(this)
      }
    ];
  }

  private async handleList(msg: InboundMessage): Promise<InboundMessage> {
    const roles = this.agentRoleService.listResolvedRoles();
    const lines = ['可用 Agent 角色：'];

    for (const role of roles) {
      const label = role.builtin ? `${role.name} (内建)` : role.name;
      lines.push(`- ${label}: ${role.description || '无描述'}`);
    }

    return { ...msg, content: lines.join('\n') };
  }

  private async handleCurrent(msg: InboundMessage): Promise<InboundMessage> {
    const sessionKey = msg.sessionKey;
    if (!sessionKey) {
      return { ...msg, content: '当前消息未绑定会话，无法查看 Agent 角色。' };
    }

    const currentRole = await this.sessionManager.getSessionAgent(sessionKey) || this.agentRoleService.getDefaultRoleName();
    return { ...msg, content: `当前会话角色：${currentRole}` };
  }

  private async handleUse(msg: InboundMessage, args: string[]): Promise<InboundMessage> {
    const sessionKey = msg.sessionKey;
    if (!sessionKey) {
      return { ...msg, content: '当前消息未绑定会话，无法切换 Agent 角色。' };
    }

    const roleName = args[0];
    const role = this.agentRoleService.getResolvedRole(roleName);
    if (!role) {
      return { ...msg, content: `Agent 角色不存在：${roleName}` };
    }

    await this.sessionManager.setSessionAgent(sessionKey, role.name);
    return { ...msg, content: `已切换当前会话角色为 ${role.name}` };
  }

  private async handleReset(msg: InboundMessage): Promise<InboundMessage> {
    const sessionKey = msg.sessionKey;
    if (!sessionKey) {
      return { ...msg, content: '当前消息未绑定会话，无法重置 Agent 角色。' };
    }

    await this.sessionManager.clearSessionAgent(sessionKey);
    return { ...msg, content: `已将当前会话角色重置为 ${this.agentRoleService.getDefaultRoleName()}` };
  }
}
