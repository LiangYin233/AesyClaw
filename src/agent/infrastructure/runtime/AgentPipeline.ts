import type { InboundMessage, OutboundMessage } from '../../../types.js';
import type { PluginManager } from '../../../plugins/index.js';
import type { CommandRegistry } from '../../application/index.js';
import { logger } from '../../../observability/index.js';

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
      this.log.info('内建命令已处理消息', {
        channel: message.channel,
        chatId: message.chatId,
        suppressOutbound
      });
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

    const pluginCommandResult = await pluginManager.runCommands(message);
    if (pluginCommandResult !== null) {
      this.log.info('插件命令已处理消息', {
        channel: message.channel,
        chatId: message.chatId,
        suppressOutbound
      });
      if (pluginCommandResult.type === 'reply' && !suppressOutbound) {
        await sendOutbound({
          channel: pluginCommandResult.message.channel,
          chatId: pluginCommandResult.message.chatId,
          content: pluginCommandResult.message.content,
          messageType: pluginCommandResult.message.messageType
        });
      }

      return pluginCommandResult.type === 'reply'
        ? { type: 'reply', content: pluginCommandResult.message.content }
        : { type: 'handled' };
    }

    const transformed = await pluginManager.runMessageInHooks(message);
    if (transformed === null) {
      this.log.debug('插件已消费消息', {
        channel: message.channel,
        chatId: message.chatId
      });
      return { type: 'handled' };
    }

    if (this.shouldSkipLLM(transformed)) {
      this.log.info('插件已跳过 LLM 处理', {
        channel: transformed.channel,
        chatId: transformed.chatId,
        reason: this.getSkipReason(transformed),
        suppressOutbound
      });
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

  private getSkipReason(message: InboundMessage): string {
    if (message.intent && message.intent.type !== 'continue') {
      return `${message.intent.type}: ${message.intent.reason}`;
    }
    return 'unknown';
  }

  private attachSavedFileNotes(message: InboundMessage): InboundMessage {
    if (!message.files || message.files.length === 0) {
      return message;
    }

    const savedPaths = message.files.filter((file) => file.localPath).map((file) => file.localPath!);
    if (savedPaths.length === 0) {
      return message;
    }

    this.log.debug('已附加保存的文件备注', {
      channel: message.channel,
      chatId: message.chatId,
      fileCount: savedPaths.length
    });

    const note = savedPaths.map((path) => `[文件已保存至: ${path}]`).join('\n');
    return {
      ...message,
      content: message.content ? `${message.content}\n${note}` : note
    };
  }
}
