import type { InboundMessage, LLMMessage, LLMResponse, OutboundMessage } from '../../../types.js';
import type { SessionManager } from '../../../session/SessionManager.js';
import type { PluginManager } from '../../../plugins/index.js';
import { logger } from '../../../logger/index.js';

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

export class ExecutionCompletionService {
  private log = logger.child({ prefix: 'ExecutionCompletion' });

  constructor(
    private sessionManager: SessionManager,
    private pluginManager?: PluginManager
  ) {}

  async finalize(params: FinalizeExecutionParams): Promise<void> {
    const {
      sessionKey,
      request,
      content,
      reasoning_content,
      agentMode,
      sessionMessages,
      suppressOutbound = false,
      sendOutbound
    } = params;

    const session = await this.sessionManager.getOrCreate(sessionKey);
    await this.sessionManager.addMessage(sessionKey, 'user', request.content);

    const assistantMessages = this.extractAssistantContents(sessionMessages);
    if (assistantMessages.length > 0) {
      for (const assistantContent of assistantMessages) {
        await this.sessionManager.addMessage(sessionKey, 'assistant', assistantContent);
      }
    } else if (content) {
      await this.sessionManager.addMessage(sessionKey, 'assistant', content);
    }

    await this.sessionManager.save(session);

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

    this.log.info(`Finalized execution for session ${sessionKey}`);
  }

  async handleError(error: unknown, sessionKey: string): Promise<void> {
    if (this.pluginManager) {
      await this.pluginManager.applyOnError(error, { type: 'agent', data: { sessionKey } });
    }
  }

  private extractAssistantContents(messages: LLMMessage[]): string[] {
    return messages
      .filter(message => message.role === 'assistant' && !!message.content)
      .map(message => this.normalizeContent(message.content))
      .filter((content): content is string => content.length > 0);
  }

  private normalizeContent(content: LLMMessage['content']): string {
    if (typeof content === 'string') {
      return content;
    }

    return content
      .filter(part => part.type === 'text' && !!part.text)
      .map(part => part.text!)
      .join('');
  }
}
