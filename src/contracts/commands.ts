import type { CommandRegistrationScope } from '@/platform/commands/command-manager.js';

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

export type PluginCommandRegistrar = Pick<CommandRegistrationScope, 'register' | 'registerMany' | 'unregister' | 'listOwnedNames' | 'dispose'>;

export interface PluginRuntimeConfig {
  name: string;
  enabled: boolean;
  options?: Record<string, unknown>;
}

export type ConfigDefaultsScope = 'plugin' | 'channel';

export interface PluginConfigStore {
  registerDefaults(scope: ConfigDefaultsScope, name: string, defaults: Record<string, unknown>): void;
  getPluginRuntimeConfig(name: string): PluginRuntimeConfig | undefined;
  onPluginConfigChange(
    listener: (
      _next: readonly PluginRuntimeConfig[],
      _prev: readonly PluginRuntimeConfig[]
    ) => void | Promise<void>
  ): () => void;
  syncAllDefaultConfigs(): Promise<void>;
  updatePluginRuntimeConfig(
    name: string,
    changes: { enabled: boolean; options?: Record<string, unknown> }
  ): Promise<boolean>;
}
