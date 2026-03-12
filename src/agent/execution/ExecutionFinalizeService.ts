import type { InboundMessage, LLMMessage, LLMResponse, OutboundMessage } from '../../types.js';
import type { SessionManager } from '../../session/SessionManager.js';
import type { PluginManager } from '../../plugins/index.js';
import type { SessionMemoryService } from '../memory/SessionMemoryService.js';
import { logger } from '../../logger/index.js';

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

export class ExecutionFinalizeService {
  private log = logger.child({ prefix: 'ExecutionFinalize' });

  constructor(
    private sessionManager: SessionManager,
    private pluginManager?: PluginManager,
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

    if (this.pluginManager) {
      await this.pluginManager.applyOnAgentAfter(request, llmResponse);
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
      await this.memoryService.maybePersistMemory(sessionKey, request.content, content);
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
    if (this.pluginManager) {
      await this.pluginManager.applyOnError(error, { type: 'agent', data: { sessionKey } });
    }
  }
}
