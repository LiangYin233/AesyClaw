import type { InboundMessage } from '../../../types.js';
import type { ToolContext } from '../../../platform/tools/ToolRegistry.js';
import type { SessionManager, SessionMessage } from '../../../features/sessions/application/SessionManager.js';
import type { SessionRoutingService } from './SessionRoutingService.js';
import type { SessionMemoryService } from '../memory/SessionMemoryService.js';
import type { AgentRoleService } from '../roles/AgentRoleService.js';
import type { ExecutionContext } from '../execution/ExecutionTypes.js';
import { sliceRecentConversationRounds } from '../memory/conversationRounds.js';

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
