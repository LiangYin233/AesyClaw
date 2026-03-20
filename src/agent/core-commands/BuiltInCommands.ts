import type { InboundMessage } from '../../types.js';
import type { SessionManager } from '../../session/SessionManager.js';
import type { AgentRoleService } from '../core-roles/AgentRoleService.js';
import type { SessionRoutingService } from '../core-session/SessionRoutingService.js';
import type { AgentRuntime } from '../core-runtime/AgentRuntime.js';
import { logger } from '../../observability/index.js';
import { CommandHandler, type CommandDefinition } from './CommandHandler.js';

export class BuiltInCommands extends CommandHandler {
  private log = logger.child('BuiltInCommands');

  constructor(
    private sessionManager: SessionManager,
    private sessionRouting: SessionRoutingService,
    private agentRoleService: AgentRoleService,
    private agent: Pick<AgentRuntime, 'abortSession'>
  ) {
    super();
  }

  getCommands(): CommandDefinition[] {
    return [
      {
        name: 'new',
        description: '创建新的会话',
        matcher: { type: 'exact', value: '/new' },
        handler: this.handleNew.bind(this)
      },
      {
        name: 'list',
        description: '列出当前频道的所有会话',
        matcher: { type: 'exact', value: '/list' },
        handler: this.handleList.bind(this)
      },
      {
        name: 'switch',
        description: '切换到指定会话',
        matcher: { type: 'regex', value: /^\/switch\s+(\d+)$/ },
        handler: this.handleSwitch.bind(this)
      },
      {
        name: 'stop',
        description: '停止当前聊天中的运行任务',
        matcher: { type: 'exact', value: '/stop' },
        handler: this.handleStop.bind(this)
      },
      {
        name: 'agent-list',
        description: '列出可用 Agent 角色',
        matcher: { type: 'exact', value: '/agent list' },
        handler: this.handleAgentList.bind(this)
      },
      {
        name: 'agent-current',
        description: '查看当前聊天 Agent 角色',
        matcher: { type: 'exact', value: '/agent current' },
        handler: this.handleAgentCurrent.bind(this)
      },
      {
        name: 'agent-use',
        description: '切换当前聊天 Agent 角色',
        matcher: { type: 'regex', value: /^\/agent\s+use\s+([\w-]+)$/ },
        handler: this.handleAgentUse.bind(this)
      },
      {
        name: 'agent-reset',
        description: '重置当前聊天 Agent 角色',
        matcher: { type: 'exact', value: '/agent reset' },
        handler: this.handleAgentReset.bind(this)
      }
    ];
  }

  private async handleNew(msg: InboundMessage): Promise<InboundMessage> {
    const newSessionKey = this.sessionRouting.createNewSession(msg.channel, msg.chatId);
    const uuid = newSessionKey.split(':')[2] || 'default';

    this.log.info(`已创建新会话: ${newSessionKey}`);

    return {
      ...msg,
      sessionKey: newSessionKey,
      content: `已开启新对话 (${uuid})`
    };
  }

  private async handleList(msg: InboundMessage): Promise<InboundMessage> {
    const currentSessionKey = this.sessionRouting.getActiveSession(msg.channel, msg.chatId);
    const channelSessions = this.sessionManager.list()
      .filter(s => s.channel === msg.channel && s.chatId === msg.chatId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    if (channelSessions.length === 0) {
      return { ...msg, content: '当前频道没有会话' };
    }

    const lines = ['会话列表：'];
    channelSessions.forEach((session, index) => {
      const uuid = session.uuid || 'default';
      const marker = session.key === currentSessionKey ? '→' : ' ';
      const createdAt = new Date(session.createdAt).toLocaleString('zh-CN');
      const updatedAt = new Date(session.updatedAt).toLocaleString('zh-CN');
      lines.push(`${marker} ${index + 1}. ${uuid} | ${session.messages.length}条消息 | 创建于${createdAt} | 更新于${updatedAt}`);
    });
    lines.push('');
    lines.push('使用 /switch <序号> 切换当前活动会话');

    return { ...msg, content: lines.join('\n') };
  }

  private async handleSwitch(msg: InboundMessage, args: string[]): Promise<InboundMessage> {
    const targetIndex = parseInt(args[0], 10);
    const channelSessions = this.sessionManager.list()
      .filter(s => s.channel === msg.channel && s.chatId === msg.chatId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    if (targetIndex < 1 || targetIndex > channelSessions.length) {
      return {
        ...msg,
        content: `无效的序号：${targetIndex}。请使用 /list 查看可用会话（1-${channelSessions.length}）`
      };
    }

    const targetSession = channelSessions[targetIndex - 1];
    this.sessionRouting.switchSession(msg.channel, msg.chatId, targetSession.key);
    this.log.info(`已切换到会话: ${targetSession.key}`);

    return {
      ...msg,
      content: `已切换到会话 ${targetSession.uuid || 'default'}（${targetSession.messages.length}条消息）`
    };
  }

  private async handleStop(msg: InboundMessage): Promise<InboundMessage> {
    const aborted = this.agent.abortSession(msg.channel, msg.chatId);

    return {
      ...msg,
      content: aborted ? '已停止当前聊天中的运行任务。' : '当前聊天没有正在运行的任务。'
    };
  }

  private async handleAgentList(msg: InboundMessage): Promise<InboundMessage> {
    const roles = this.agentRoleService.listResolvedRoles();
    const lines = ['可用 Agent 角色：'];

    for (const role of roles) {
      const label = role.builtin ? `${role.name} (内建)` : role.name;
      lines.push(`- ${label}: ${role.description || '无描述'}`);
    }

    return { ...msg, content: lines.join('\n') };
  }

  private async handleAgentCurrent(msg: InboundMessage): Promise<InboundMessage> {
    const currentRole = this.sessionRouting.getConversationAgent(msg.channel, msg.chatId)
      || this.agentRoleService.getDefaultRoleName();
    return { ...msg, content: `当前聊天角色：${currentRole}` };
  }

  private async handleAgentUse(msg: InboundMessage, args: string[]): Promise<InboundMessage> {
    const roleName = args[0];
    const role = this.agentRoleService.getResolvedRole(roleName);
    if (!role) {
      return { ...msg, content: `Agent 角色不存在：${roleName}` };
    }

    this.sessionRouting.setConversationAgent(msg.channel, msg.chatId, role.name);
    return { ...msg, content: `已切换当前聊天角色为 ${role.name}` };
  }

  private async handleAgentReset(msg: InboundMessage): Promise<InboundMessage> {
    this.sessionRouting.clearConversationAgent(msg.channel, msg.chatId);
    return { ...msg, content: `已将当前聊天角色重置为 ${this.agentRoleService.getDefaultRoleName()}` };
  }
}
