import type { InboundMessage } from '../../types.js';

export interface CommandMatcher {
  type: 'regex' | 'prefix' | 'exact' | 'contains';
  value: string | RegExp;
}

export interface CommandDefinition {
  name: string;
  description: string;
  matcher: CommandMatcher;
  handler: (msg: InboundMessage, args: string[]) => Promise<InboundMessage | null>;
}

export abstract class CommandHandler {
  abstract getCommands(): CommandDefinition[];
}
