import type { InboundMessage } from '../../../types.js';
import { ResourceNotFoundError } from '../../../platform/errors/domain.js';
import { PluginsService } from '../../../features/plugins/application/PluginsService.js';
import type { PluginInfo } from '../../../features/plugins/domain/types.js';
import type { SessionManager } from '../../../features/sessions/application/SessionManager.js';
import type { AgentRoleService } from '../../infrastructure/roles/AgentRoleService.js';
import type { SessionRoutingService } from '../../infrastructure/session/SessionRoutingService.js';
import { logger } from '../../../platform/observability/index.js';
import { CommandHandler, type CommandDefinition } from './CommandHandler.js';

interface AbortSessionPort {
  abortSession(sessionKeyOrChannel: string, chatId?: string): boolean;
}

export class BuiltInCommands extends CommandHandler {
  private log = logger.child('BuiltInCommands');

  constructor(
    private sessionManager: SessionManager,
    private sessionRouting: SessionRoutingService,
    private agentRoleService: AgentRoleService,
    private agent: AbortSessionPort,
    private pluginsService: PluginsService
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
      },
      {
        name: 'plugin-root',
        description: '列出可管理的插件',
        matcher: { type: 'exact', value: '/plugin' },
        handler: this.handlePluginList.bind(this)
      },
      {
        name: 'plugin-list',
        description: '列出可管理的插件',
        matcher: { type: 'exact', value: '/plugin list' },
        handler: this.handlePluginList.bind(this)
      },
      {
        name: 'plugin-info',
        description: '查看插件详情',
        matcher: { type: 'regex', value: /^\/plugin\s+info\s+(\S+)$/ },
        handler: this.handlePluginInfo.bind(this)
      },
      {
        name: 'plugin-enable',
        description: '启用插件',
        matcher: { type: 'regex', value: /^\/plugin\s+enable\s+(\S+)$/ },
        handler: this.handlePluginEnable.bind(this)
      },
      {
        name: 'plugin-disable',
        description: '停用插件',
        matcher: { type: 'regex', value: /^\/plugin\s+disable\s+(\S+)$/ },
        handler: this.handlePluginDisable.bind(this)
      },
      {
        name: 'plugin-fallback',
        description: '插件命令帮助',
        matcher: { type: 'prefix', value: '/plugin' },
        handler: this.handlePluginFallback.bind(this)
      }
    ];
  }

  private async handleNew(msg: InboundMessage): Promise<InboundMessage> {
    if (this.sessionRouting.getContextMode() === 'channel') {
      return {
        ...msg,
        content: '当前为 channel 上下文模式，整条会话共享同一个上下文，不能新建独立会话。'
      };
    }

    const newSessionKey = this.sessionRouting.createNewSession(msg.channel, msg.chatId);
    const uuid = newSessionKey.split(':')[2] || 'default';

    return {
      ...msg,
      sessionKey: newSessionKey,
      content: `已开启新对话 (${uuid})`
    };
  }

  private async handleList(msg: InboundMessage): Promise<InboundMessage> {
    if (this.sessionRouting.getContextMode() === 'channel') {
      return {
        ...msg,
        content: '当前为 channel 上下文模式，当前聊天固定使用单一会话，不支持列出或切换多会话。'
      };
    }

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
    if (this.sessionRouting.getContextMode() === 'channel') {
      return {
        ...msg,
        content: '当前为 channel 上下文模式，不支持切换会话。'
      };
    }

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

  private async handlePluginList(msg: InboundMessage): Promise<InboundMessage> {
    const plugins = await this.getPlugins();
    const lines = ['插件列表：'];

    if (plugins.length === 0) {
      lines.push('当前没有可管理的插件。');
    } else {
      for (const plugin of plugins) {
        const detail = plugin.kind === 'channel'
          ? `渠道=${plugin.channelName || '-'} | 运行=${plugin.running ? '是' : '否'}`
          : `版本=${plugin.version} | tools=${plugin.toolsCount}`;
        lines.push(`- ${plugin.name} [${this.getPluginKindLabel(plugin)}] ${plugin.enabled ? '已启用' : '已停用'} | ${detail}`);
      }
    }

    lines.push('');
    lines.push('用法：');
    lines.push('/plugin info <name>');
    lines.push('/plugin enable <name>');
    lines.push('/plugin disable <name>');

    return {
      ...msg,
      content: lines.join('\n')
    };
  }

  private async handlePluginInfo(msg: InboundMessage, args: string[]): Promise<InboundMessage> {
    const name = args[0];
    const plugin = await this.findPluginByName(name);
    if (!plugin) {
      return {
        ...msg,
        content: `插件不存在：${name}`
      };
    }

    const lines = [
      '插件详情：',
      `名称：${plugin.name}`,
      `类型：${this.getPluginKindLabel(plugin)}`,
      `状态：${plugin.enabled ? '已启用' : '已停用'}`,
      `描述：${plugin.description || '无描述'}`,
      `作者：${plugin.author || '未知'}`,
      `版本：${plugin.version}`,
      `工具数：${plugin.toolsCount}`,
      `当前选项：${this.formatPluginOptions(plugin.options)}`
    ];

    if (plugin.kind === 'channel') {
      lines.push(`渠道：${plugin.channelName || '-'}`);
      lines.push(`运行中：${plugin.running ? '是' : '否'}`);
    }

    return {
      ...msg,
      content: lines.join('\n')
    };
  }

  private async handlePluginEnable(msg: InboundMessage, args: string[]): Promise<InboundMessage> {
    return this.togglePlugin(msg, args[0], true);
  }

  private async handlePluginDisable(msg: InboundMessage, args: string[]): Promise<InboundMessage> {
    return this.togglePlugin(msg, args[0], false);
  }

  private async handlePluginFallback(msg: InboundMessage, args: string[]): Promise<InboundMessage> {
    if (args.length === 0) {
      return this.handlePluginList(msg);
    }

    const [subcommand] = args;
    if (subcommand === 'info' || subcommand === 'enable' || subcommand === 'disable') {
      return {
        ...msg,
        content: ['参数不完整。', '', this.getPluginHelpText()].join('\n')
      };
    }

    return {
      ...msg,
      content: [`未知的 /plugin 子命令：${args.join(' ')}`, '', this.getPluginHelpText()].join('\n')
    };
  }

  private async togglePlugin(msg: InboundMessage, name: string, enabled: boolean): Promise<InboundMessage> {
    const plugin = await this.findPluginByName(name);
    if (!plugin) {
      return {
        ...msg,
        content: `插件不存在：${name}`
      };
    }

    try {
      await this.pluginsService.togglePlugin(plugin.name, enabled);
    } catch (error) {
      if (error instanceof ResourceNotFoundError) {
        return {
          ...msg,
          content: `插件不存在：${plugin.name}`
        };
      }

      throw error;
    }

    return {
      ...msg,
      content: `${enabled ? '已启用' : '已停用'}插件 ${plugin.name}`
    };
  }

  private async getPlugins(): Promise<PluginInfo[]> {
    const result = await this.pluginsService.listPlugins();
    return result.plugins;
  }

  private async findPluginByName(name: string): Promise<PluginInfo | undefined> {
    const plugins = await this.getPlugins();
    return plugins.find((plugin) => plugin.name === name);
  }

  private getPluginKindLabel(plugin: PluginInfo): string {
    return plugin.kind === 'channel' ? '渠道插件' : '普通插件';
  }

  private formatPluginOptions(options: PluginInfo['options']): string {
    if (!options || Object.keys(options).length === 0) {
      return '无';
    }

    try {
      const serialized = JSON.stringify(options);
      return serialized.length > 200 ? `${serialized.slice(0, 197)}...` : serialized;
    } catch {
      return '[无法序列化]';
    }
  }

  private getPluginHelpText(): string {
    return [
      '用法：',
      '/plugin',
      '/plugin list',
      '/plugin info <name>',
      '/plugin enable <name>',
      '/plugin disable <name>'
    ].join('\n');
  }
}
