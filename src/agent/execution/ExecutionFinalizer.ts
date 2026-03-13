import type { InboundMessage, LLMMessage, LLMResponse, OutboundMessage } from '../../types.js';
import type { SessionManager } from '../../session/SessionManager.js';
import type { PluginManager } from '../../plugins/index.js';
import type { SessionMemoryService } from '../memory/SessionMemoryService.js';
import { logger } from '../../observability/index.js';

export interface FinalizeExecutionParams {
  sessionKey: string;
  request: InboundMessage;
  content: string;
  reasoning_content?: string;
  agentMode: boolean;
  sessionMessages: LLMMessage[];
  suppressOutbound?: boolean;
  sendOutbound: (message: OutboundMessage) => Promise<void>;
}

export class ExecutionFinalizer {
  private log = logger.child('ExecutionFinalizer');

  constructor(
    private sessionManager: SessionManager,
    private getPluginManager: () => PluginManager | undefined,
    private memoryService?: SessionMemoryService
  ) {}

  async finalize(params: FinalizeExecutionParams): Promise<void> {
    const {
      sessionKey,
      request,
      content,
      reasoning_content,
      agentMode,
      sessionMessages: _sessionMessages,
      suppressOutbound = false,
      sendOutbound
    } = params;

    await this.sessionManager.addMessage(sessionKey, 'user', request.content);
    if (content) {
      await this.sessionManager.addMessage(sessionKey, 'assistant', content);
    }

    const llmResponse: LLMResponse = {
      content,
      reasoning_content,
      toolCalls: [],
      finishReason: agentMode ? 'tool_use' : 'stop'
    };

    const pluginManager = this.getPluginManager();
    if (pluginManager) {
      await pluginManager.runAgentAfterTaps({
        message: request,
        response: llmResponse
      });
    }

    if (!suppressOutbound) {
      await sendOutbound({
        channel: request.channel,
        chatId: request.chatId,
        content,
        reasoning_content,
        messageType: request.messageType
      });
    }

    if (this.memoryService) {
      await this.memoryService.maybePersistMemoryForRequest(sessionKey, request, content);
    }

    this.log.info('Execution response finalized', {
      sessionKey,
      channel: request.channel,
      chatId: request.chatId,
      messageType: request.messageType,
      outboundSuppressed: suppressOutbound,
      responseLength: content.length
    });
  }

  async handleError(error: unknown, sessionKey: string): Promise<void> {
    const pluginManager = this.getPluginManager();
    if (pluginManager) {
      await pluginManager.runErrorTaps(error, { type: 'agent', data: { sessionKey } });
    }
  }
}
