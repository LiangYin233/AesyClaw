import type { InboundMessage } from '../../types.js';
import type { ToolContext } from '../../tools/ToolRegistry.js';
import type { SessionManager } from '../../session/SessionManager.js';
import type { SessionRoutingService } from '../session/SessionRoutingService.js';
import type { SessionMemoryService } from '../memory/SessionMemoryService.js';
import type { AgentRoleService } from '../roles/AgentRoleService.js';
import type { ExecutionContext } from './contracts.js';

export interface ExecutionContextResolverOptions {
  toolContext: ToolContext;
  suppressOutbound?: boolean;
  memoryWindow: number;
}

export class ExecutionContextResolver {
  constructor(
    private sessionManager: SessionManager,
    private sessionRouting: SessionRoutingService,
    private memoryService?: SessionMemoryService,
    private agentRoleService?: AgentRoleService
  ) {}

  async resolve(msg: InboundMessage, options: ExecutionContextResolverOptions): Promise<ExecutionContext> {
    let sessionKey = msg.sessionKey;
    if (!sessionKey) {
      const { sessionKey: resolvedSessionKey } = this.sessionRouting.resolve(msg);
      sessionKey = resolvedSessionKey;
      msg.sessionKey = resolvedSessionKey;
    }

    const session = await this.sessionManager.getOrCreate(sessionKey);
    const history = this.memoryService
      ? await this.memoryService.buildHistory(session)
      : session.messages.slice(-options.memoryWindow);

    return {
      request: msg,
      sessionKey,
      channel: msg.channel,
      chatId: msg.chatId,
      messageType: msg.messageType,
      agentName: (await this.sessionManager.getSessionAgent(sessionKey))
        || this.agentRoleService?.getDefaultRoleName()
        || 'main',
      session,
      history,
      suppressOutbound: options.suppressOutbound === true,
      toolContext: {
        ...options.toolContext,
        channel: msg.channel,
        chatId: msg.chatId,
        messageType: msg.messageType
      }
    };
  }
}
