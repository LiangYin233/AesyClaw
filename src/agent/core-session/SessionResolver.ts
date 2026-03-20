import type { InboundMessage } from '../../types.js';
import type { ToolContext } from '../../tools/ToolRegistry.js';
import type { SessionManager, SessionMessage } from '../../session/SessionManager.js';
import type { SessionRoutingService } from './SessionRoutingService.js';
import type { SessionMemoryService } from '../core-memory/SessionMemoryService.js';
import type { AgentRoleService } from '../core-roles/AgentRoleService.js';
import type { ExecutionContext } from '../core-execution/ExecutionTypes.js';
import { sliceRecentConversationRounds } from '../core-memory/conversationRounds.js';

export interface SessionResolverOptions {
  toolContext: ToolContext;
  suppressOutbound?: boolean;
  memoryWindow: number;
}

export class SessionResolver {
  constructor(
    private sessionManager: SessionManager,
    private sessionRouting: SessionRoutingService,
    private memoryService?: SessionMemoryService,
    private agentRoleService?: AgentRoleService
  ) {}

  setMemoryService(memoryService?: SessionMemoryService): void {
    this.memoryService = memoryService;
  }

  async resolve(message: InboundMessage, options: SessionResolverOptions): Promise<ExecutionContext> {
    let sessionKey = message.sessionKey;
    if (!sessionKey) {
      const resolved = this.sessionRouting.resolve(message);
      sessionKey = resolved.sessionKey;
      message.sessionKey = resolved.sessionKey;
    }

    const session = await this.sessionManager.getOrCreate(sessionKey);
    const history = this.memoryService
      ? await this.memoryService.buildHistory(session, message)
      : await this.buildHistoryWithoutMemory(session, options.memoryWindow);

    return {
      request: message,
      sessionKey,
      channel: message.channel,
      chatId: message.chatId,
      messageType: message.messageType,
      agentName: this.sessionRouting.getConversationAgent(message.channel, message.chatId)
        || this.agentRoleService?.getDefaultRoleName()
        || 'main',
      session,
      history,
      suppressOutbound: options.suppressOutbound === true,
      toolContext: {
        ...options.toolContext,
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
