export interface CommandDefinition {
  name: string;
  description: string;
  usage: string;
  aliases?: string[];
  category: 'system' | 'plugin';
  execute: (ctx: CommandContext) => Promise<CommandResult>;
}

export interface CommandContext {
  chatId: string;
  senderId: string;
  args: string[];
  rawArgs: string;
  traceId: string;
}

export interface CommandResult {
  success: boolean;
  message: string;
  data?: unknown;
}

export interface ParsedCommand {
  name: string;
  args: string[];
  rawArgs: string;
}
