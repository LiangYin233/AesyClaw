import type { InboundMessage, OutboundMessage } from '../../../types.js';
import type { CommandRegistry } from '../../application/index.js';
import { logger } from '../../../platform/observability/index.js';
import type { PluginManager } from '../../../platform/context/PluginContext.js';

export type PipelineResult =
  | { type: 'continue'; message: InboundMessage }
  | { type: 'reply'; content: string }
  | { type: 'handled' };

export class AgentPipeline {
  private log = logger.child('AgentPipeline');

  constructor(
    private commandRegistry: CommandRegistry,
    private getPluginManager: () => PluginManager | undefined
  ) {}

  async process(
    message: InboundMessage,
    options: {
      suppressOutbound?: boolean;
      sendOutbound: (message: OutboundMessage) => Promise<void>;
    }
  ): Promise<PipelineResult> {
    const { suppressOutbound = false, sendOutbound } = options;
    const pluginManager = this.getPluginManager();
    message = this.attachSavedFileNotes(message);

    const builtInResult = await this.commandRegistry.execute(message);
    if (builtInResult !== null) {
      if (!suppressOutbound) {
        await sendOutbound({
          channel: builtInResult.channel,
          chatId: builtInResult.chatId,
          content: builtInResult.content,
          messageType: builtInResult.messageType
        });
      }
      return { type: 'reply', content: builtInResult.content };
    }

    if (!pluginManager) {
      return { type: 'continue', message };
    }

    const pluginCommandResult = await pluginManager.executeCommand(message);
    if (pluginCommandResult !== null) {
      if (pluginCommandResult.resultType === 'modified') {
        message = pluginCommandResult.message;
      }
      if (!suppressOutbound && pluginCommandResult.resultType === 'modified') {
        await sendOutbound({
          channel: message.channel,
          chatId: message.chatId,
          content: message.content,
          messageType: message.messageType
        });
      }
      return pluginCommandResult.resultType === 'modified'
        ? { type: 'reply', content: message.content }
        : { type: 'handled' };
    }

    const transformed = await pluginManager.transformIncomingMessage(message);
    if (transformed === null) {
      return { type: 'handled' };
    }

    if (this.shouldSkipLLM(transformed)) {
      if (!suppressOutbound) {
        await sendOutbound({
          channel: transformed.channel,
          chatId: transformed.chatId,
          content: transformed.content,
          messageType: transformed.messageType
        });
      }
      return { type: 'reply', content: transformed.content };
    }

    return { type: 'continue', message: transformed };
  }

  private shouldSkipLLM(message: InboundMessage): boolean {
    return !!message.intent && message.intent.type !== 'continue';
  }

  private attachSavedFileNotes(message: InboundMessage): InboundMessage {
    if (!message.files || message.files.length === 0) {
      return message;
    }

    const savedPaths = message.files.filter((file) => file.localPath).map((file) => file.localPath!);
    if (savedPaths.length === 0) {
      return message;
    }

    const note = savedPaths.map((path) => `[文件已保存至: ${path}]`).join('\n');
    return {
      ...message,
      content: message.content ? `${message.content}\n${note}` : note
    };
  }
}
