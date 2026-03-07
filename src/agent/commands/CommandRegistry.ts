import type { InboundMessage } from '../../types.js';
import type { CommandHandler, CommandDefinition, CommandMatcher } from './CommandHandler.js';
import { logger } from '../../logger/index.js';

export class CommandRegistry {
  private commands: Map<string, CommandDefinition> = new Map();
  private log = logger.child({ prefix: 'CommandRegistry' });

  registerHandler(handler: CommandHandler): void {
    const commands = handler.getCommands();
    for (const cmd of commands) {
      this.commands.set(cmd.name, cmd);
      this.log.debug(`Registered command: ${cmd.name}`);
    }
  }

  async execute(msg: InboundMessage): Promise<InboundMessage | null> {
    const content = msg.content.trim();

    for (const cmd of this.commands.values()) {
      const { matched, args } = this.matchCommand(content, cmd.matcher);
      if (matched) {
        this.log.info(`Executing command: ${cmd.name}`);
        try {
          return await cmd.handler(msg, args);
        } catch (error) {
          this.log.error(`Command ${cmd.name} failed:`, error);
          return {
            ...msg,
            content: `命令执行失败: ${error instanceof Error ? error.message : String(error)}`
          };
        }
      }
    }

    return null;
  }

  private matchCommand(content: string, matcher: CommandMatcher): { matched: boolean; args: string[] } {
    switch (matcher.type) {
      case 'exact':
        return {
          matched: content === matcher.value,
          args: []
        };

      case 'prefix':
        if (typeof matcher.value === 'string' && content.startsWith(matcher.value)) {
          const argsStr = content.slice(matcher.value.length).trim();
          return {
            matched: true,
            args: argsStr ? argsStr.split(/\s+/) : []
          };
        }
        return { matched: false, args: [] };

      case 'contains':
        if (typeof matcher.value === 'string' && content.includes(matcher.value)) {
          return { matched: true, args: [] };
        }
        return { matched: false, args: [] };

      case 'regex':
        if (matcher.value instanceof RegExp) {
          const match = content.match(matcher.value);
          if (match) {
            return {
              matched: true,
              args: match.slice(1)
            };
          }
        }
        return { matched: false, args: [] };

      default:
        return { matched: false, args: [] };
    }
  }
}
