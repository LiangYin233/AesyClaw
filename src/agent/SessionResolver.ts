import type { InboundMessage } from '../types.js';
import type { ToolContext } from '../tools/ToolRegistry.js';
import type { SessionManager } from '../session/SessionManager.js';
import type { SessionRoutingService } from './session/SessionRoutingService.js';
import type { SessionMemoryService } from './memory/SessionMemoryService.js';
import type { AgentRoleService } from './roles/AgentRoleService.js';
import type { ExecutionContext } from './execution/contracts.js';

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

  async resolve(message: InboundMessage, options: SessionResolverOptions): Promise<ExecutionContext> {
    let sessionKey = message.sessionKey;
    if (!sessionKey) {
      const resolved = this.sessionRouting.resolve(message);
      sessionKey = resolved.sessionKey;
      message.sessionKey = resolved.sessionKey;
    }

    const session = await this.sessionManager.getOrCreate(sessionKey);
    const history = this.memoryService
      ? await this.memoryService.buildHistory(session)
      : session.messages.slice(-options.memoryWindow);

    return {
      request: message,
      sessionKey,
      channel: message.channel,
      chatId: message.chatId,
      messageType: message.messageType,
      agentName: (await this.sessionManager.getSessionAgent(sessionKey))
        || this.agentRoleService?.getDefaultRoleName()
        || 'main',
      session,
      history,
      suppressOutbound: options.suppressOutbound === true,
      toolContext: {
        ...options.toolContext,
        channel: message.channel,
        chatId: message.chatId,
        messageType: message.messageType
      }
    };
  }
}
