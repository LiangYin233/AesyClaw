import type { InboundMessage, LLMMessage, OutboundMessage } from '../../types.js';
import type { ToolContext } from '../../tools/ToolRegistry.js';
import type { PluginManager } from '../../plugins/index.js';
import type { AgentExecutor } from '../executor/AgentExecutor.js';
import type { ExecutionCoordinator } from '../routing/ExecutionCoordinator.js';
import { logger } from '../../logger/index.js';

export interface ExecuteMessageRequest {
  sessionKey: string;
  request: InboundMessage;
  history: LLMMessage[];
  toolContext: ToolContext;
  suppressOutbound?: boolean;
  sendOutbound: (message: OutboundMessage) => Promise<void>;
}

export interface ExecuteMessageResult {
  content: string;
  needsBackground: boolean;
}

export class MessageApplicationService {
  private log = logger.child({ prefix: 'MessageApplication' });

  constructor(
    private executor: AgentExecutor,
    private coordinator: ExecutionCoordinator,
    private pluginManager?: PluginManager
  ) {}

  async execute(request: ExecuteMessageRequest): Promise<ExecuteMessageResult> {
    const {
      sessionKey,
      request: inbound,
      history,
      toolContext,
      suppressOutbound = false,
      sendOutbound
    } = request;

    this.executor.getContextBuilder().setCurrentContext(inbound.channel, inbound.chatId, inbound.messageType);

    const messages = this.executor.buildContext(
      history,
      inbound.content,
      inbound.media,
      inbound.files
    );

    if (this.pluginManager) {
      await this.pluginManager.applyOnAgentBefore(inbound, messages);
    }

    return this.coordinator.execute({
      sessionKey,
      request: inbound,
      messages,
      toolContext,
      suppressOutbound,
      sendOutbound
    });
  }
}
