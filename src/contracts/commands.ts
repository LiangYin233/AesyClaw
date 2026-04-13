export interface CommandDefinition {
  name: string;
  description: string;
  usage: string;
  aliases?: string[];
  category: 'system' | 'plugin';
  execute: (_ctx: CommandContext) => Promise<CommandResult>;
}

export interface CommandContext {
  chatId: string;
  channelId: string;
  messageType: string;
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

export interface PluginCommandRegistrar {
  registerFromPlugin(pluginName: string, commands: CommandDefinition[]): void;
  unregisterFromPlugin(pluginName: string): void;
}
