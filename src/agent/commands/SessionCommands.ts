import type { InboundMessage } from '../../types.js';
import type { SessionManager } from '../../session/SessionManager.js';
import type { SessionRoutingService } from '../routing/SessionRoutingService.js';
import { CommandHandler, type CommandDefinition } from './CommandHandler.js';
import { logger } from '../../logger/index.js';

export class SessionCommands extends CommandHandler {
  private sessionManager: SessionManager;
  private sessionRouting: SessionRoutingService;
  private log = logger.child({ prefix: 'SessionCommands' });

  constructor(sessionManager: SessionManager, sessionRouting: SessionRoutingService) {
    super();
    this.sessionManager = sessionManager;
    this.sessionRouting = sessionRouting;
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
      }
    ];
  }

  private async handleNew(msg: InboundMessage, _args: string[]): Promise<InboundMessage | null> {
    const newSessionKey = this.sessionRouting.createNewSession(msg.channel, msg.chatId);

    const uuid = newSessionKey.split(':')[2] || 'default';
    this.log.info(`Created new session: ${newSessionKey}`);

    return {
      ...msg,
      content: `已开启新对话 (${uuid})`
    };
  }

  private async handleList(msg: InboundMessage, _args: string[]): Promise<InboundMessage | null> {
    const currentSessionKey = this.sessionRouting.getActiveSession(msg.channel, msg.chatId);

    const allSessions = this.sessionManager.list();
    const channelSessions = allSessions
      .filter(s => s.channel === msg.channel && s.chatId === msg.chatId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    if (channelSessions.length === 0) {
      return { ...msg, content: '当前频道没有会话' };
    }

    const lines = ['会话列表：'];
    channelSessions.forEach((s, index) => {
      const uuid = s.uuid || 'default';
      const isCurrent = s.key === currentSessionKey;
      const marker = isCurrent ? '→' : ' ';
      const msgCount = s.messages.length;
      const createdAt = new Date(s.createdAt).toLocaleString('zh-CN');
      const updatedAt = new Date(s.updatedAt).toLocaleString('zh-CN');

      lines.push(`${marker} ${index + 1}. ${uuid} | ${msgCount}条消息 | 创建于${createdAt} | 更新于${updatedAt}`);
    });
    lines.push('');
    lines.push('使用 /switch <序号> 切换会话');

    return { ...msg, content: lines.join('\n') };
  }

  private async handleSwitch(msg: InboundMessage, args: string[]): Promise<InboundMessage | null> {
    const targetIndex = parseInt(args[0], 10);

    const allSessions = this.sessionManager.list();
    const channelSessions = allSessions
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

    const uuid = targetSession.uuid || 'default';
    this.log.info(`Switched to session: ${targetSession.key}`);

    return {
      ...msg,
      content: `已切换到会话 ${uuid}（${targetSession.messages.length}条消息）`
    };
  }
}
