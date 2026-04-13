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

export interface PluginRuntimeConfig {
  name: string;
  enabled: boolean;
  options?: Record<string, unknown>;
}

export interface PluginConfigStore {
  registerPluginDefaults(name: string, defaults: Record<string, unknown>): void;
  updatePluginConfig(
    name: string,
    enabled: boolean,
    options?: Record<string, unknown>
  ): Promise<boolean>;
}
