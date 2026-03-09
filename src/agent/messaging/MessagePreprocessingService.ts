import type { InboundMessage, OutboundMessage } from '../../types.js';
import type { PluginManager } from '../../plugins/index.js';
import type { CommandRegistry } from '../commands/index.js';
import { shouldSkipLLM, getSkipReason } from '../../plugins/IntentHelpers.js';
import { logger } from '../../logger/index.js';

export type PreprocessResult =
  | { type: 'continue'; message: InboundMessage }
  | { type: 'reply'; content: string }
  | { type: 'handled' };

export class MessagePreprocessingService {
  private log = logger.child({ prefix: 'MessagePreprocessing' });

  constructor(
    private commandRegistry?: CommandRegistry,
    private pluginManager?: PluginManager
  ) {}

  async process(
    message: InboundMessage,
    options: {
      suppressOutbound?: boolean;
      sendOutbound: (message: OutboundMessage) => Promise<void>;
    }
  ): Promise<PreprocessResult> {
    const { suppressOutbound = false, sendOutbound } = options;
    message = this.attachSavedFileNotes(message);

    if (this.commandRegistry) {
      const cmdResult = await this.commandRegistry.execute(message);
      if (cmdResult !== null) {
        this.log.info('Built-in command executed');
        if (!suppressOutbound) {
          await sendOutbound({
            channel: cmdResult.channel,
            chatId: cmdResult.chatId,
            content: cmdResult.content,
            messageType: cmdResult.messageType
          });
        }
        return { type: 'reply', content: cmdResult.content };
      }
    }

    if (this.pluginManager) {
      const cmdResult = await this.pluginManager.applyOnCommand(message);
      if (cmdResult !== null) {
        if (!suppressOutbound) {
          await sendOutbound({
            channel: cmdResult.channel,
            chatId: cmdResult.chatId,
            content: cmdResult.content,
            messageType: cmdResult.messageType
          });
        }
        return { type: 'reply', content: cmdResult.content };
      }

      const handled = await this.pluginManager.applyOnMessage(message);
      if (handled === null) {
        this.log.debug('Message handled by plugin (null), skipping');
        return { type: 'handled' };
      }

      if (shouldSkipLLM(handled)) {
        const reason = getSkipReason(handled);
        this.log.info(`Skipping LLM processing: ${reason}`);
        if (!suppressOutbound) {
          await sendOutbound({
            channel: handled.channel,
            chatId: handled.chatId,
            content: handled.content,
            messageType: handled.messageType
          });
        }
        return { type: 'reply', content: handled.content };
      }

      return { type: 'continue', message: handled };
    }

    return { type: 'continue', message };
  }

  private attachSavedFileNotes(message: InboundMessage): InboundMessage {
    if (!message.files || message.files.length === 0) {
      return message;
    }

    const savedPaths = message.files.filter(file => file.localPath).map(file => file.localPath!);
    if (savedPaths.length === 0) {
      return message;
    }

    this.log.info(`Received ${savedPaths.length} file(s): ${savedPaths.join(', ')}`);
    const note = savedPaths.map(path => `[文件已保存至: ${path}]`).join('\n');
    return {
      ...message,
      content: message.content ? `${message.content}\n${note}` : note
    };
  }
}
