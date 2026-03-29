import type { InboundMessage } from '../../../types.js';
import type { ToolContext } from '../../../platform/tools/ToolRegistry.js';
import type { SessionManager, SessionMessage } from '../session/SessionManager.js';
import type { ISessionRouting } from '../../domain/session.js';
import type { MemoryService } from '../../../platform/context/MemoryContext.js';
import type { AgentRoleService } from '../../../platform/context/AgentContext.js';
import type { ExecutionContext } from '../execution/ExecutionTypes.js';

interface RoleLikeMessage {
  role: string;
}

interface ConversationRound {
  start: number;
  end: number;
}

function collectConversationRounds<T extends RoleLikeMessage>(
  messages: T[],
  startIndex: number = 0
): ConversationRound[] {
  const rounds: ConversationRound[] = [];
  let index = Math.max(0, startIndex);

  while (index < messages.length) {
    while (index < messages.length && messages[index]?.role !== 'user') {
      index += 1;
    }

    if (index >= messages.length) {
      break;
    }

    const start = index;
    index += 1;

    while (index < messages.length && messages[index]?.role !== 'user') {
      index += 1;
    }

    rounds.push({
      start,
      end: index
    });
  }

  return rounds;
}

function sliceRecentConversationRounds<T extends RoleLikeMessage>(
  messages: T[],
  roundCount: number,
  startIndex: number = 0
): T[] {
  if (roundCount <= 0) {
    return [];
  }

  const rounds = collectConversationRounds(messages, startIndex);
  if (rounds.length === 0) {
    return [];
  }

  const recentRounds = rounds.slice(-roundCount);
  const first = recentRounds[0];
  const last = recentRounds[recentRounds.length - 1];
  return messages.slice(first.start, last.end);
}

export interface SessionResolverOptions {
  toolContext: ToolContext;
  suppressOutbound?: boolean;
  memoryWindow: number;
}

export class SessionResolver {
  constructor(
    private sessionManager: SessionManager,
    private sessionRouting: ISessionRouting,
    private memoryService?: MemoryService,
    private agentRoleService?: AgentRoleService
  ) {}

  setMemoryService(memoryService?: MemoryService): void {
    this.memoryService = memoryService;
  }

  async resolve(message: InboundMessage, options: SessionResolverOptions): Promise<ExecutionContext> {
    let sessionKey = message.sessionKey;
    if (!sessionKey) {
      const resolved = await this.sessionRouting.resolve(message);
      sessionKey = resolved.sessionKey;
      message.sessionKey = resolved.sessionKey;
    }

    const session = await this.sessionManager.getOrCreate(sessionKey);
    const history = this.memoryService
      ? await this.memoryService.buildHistory(session, message)
      : await this.buildHistoryWithoutMemory(session, options.memoryWindow);

    const agentName = this.sessionRouting.getConversationAgent(message.channel, message.chatId)
      || this.agentRoleService?.getDefaultRoleName()
      || 'main';

    return {
      request: message,
      sessionKey,
      channel: message.channel,
      chatId: message.chatId,
      messageType: message.messageType,
      agentName,
      session,
      history,
      suppressOutbound: options.suppressOutbound === true,
      toolContext: {
        ...options.toolContext,
        agentName,
        sessionKey,
        channel: message.channel,
        chatId: message.chatId,
        messageType: message.messageType
      }
    };
  }

  private async buildHistoryWithoutMemory(session: Awaited<ReturnType<SessionManager['getOrCreate']>>, memoryWindow: number): Promise<SessionMessage[]> {
    if (this.sessionRouting.getContextMode() !== 'channel') {
      return sliceRecentConversationRounds(session.messages, memoryWindow);
    }

    const conversationMessages = await this.sessionManager.getConversationMessages(session.channel, session.chatId);
    return sliceRecentConversationRounds(
      conversationMessages.map((message) => ({
        role: message.role,
        content: message.content,
        timestamp: message.timestamp
      })),
      memoryWindow
    );
  }
}
