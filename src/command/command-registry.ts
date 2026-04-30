/**
 * Command registry — manages command registration and execution.
 *
 * Commands are user-facing slash commands like /help, /role list, etc.
 * They are registered with a scope (ToolOwner) for automatic cleanup
 * when the owning subsystem is unloaded.
 *
 */

import type { ToolOwner, CommandDefinition, CommandContext } from '../core/types';
import { createScopedLogger } from '../core/logger';

const logger = createScopedLogger('command');

export interface ResolvedCommand {
  command: CommandDefinition;
  args: string[];
  commandName: string;
  /** Internal registry key used for uniqueness and cleanup. */
  registryKey: string;
}

/**
 * Central registry for all slash commands.
 *
 * Commands are registered with a scope for owner-based cleanup.
 * The registry enforces registry-key uniqueness — attempting to register a
 * command with a registry key that already exists throws an error.
 *
 * Registry key format (internal only; user-facing syntax remains slash separated):
 *   - If namespace is set: `namespace:name`
 *   - Otherwise: just `name`
 */
export class CommandRegistry {
  private commands: Map<string, CommandDefinition> = new Map();

  /**
   * Compute the internal registry key for a command.
   *
   * If the command has a namespace, the registry key is `namespace:name`.
   * Otherwise, just `name`.
   */
  private static registryKeyForCommand(command: CommandDefinition): string {
    return command.namespace ? `${command.namespace}:${command.name}` : command.name;
  }

  private static registryKeyForParts(name: string, namespace?: string): string {
    return namespace ? `${namespace}:${name}` : name;
  }

  /**
   * Register a command.
   *
   * @throws Error if a command with the same registry key already exists
   */
  register(command: CommandDefinition): void {
    const key = CommandRegistry.registryKeyForCommand(command);
    if (this.commands.has(key)) {
      throw new Error(`Command "${key}" is already registered`);
    }
    this.commands.set(key, command);
    logger.debug(`Registered command: ${key} (scope: ${command.scope})`);
  }

  /**
   * Unregister a command by name and optional namespace.
   *
   * No-op if the command doesn't exist.
   */
  unregister(name: string, namespace?: string): void {
    const key = CommandRegistry.registryKeyForParts(name, namespace);
    const removed = this.commands.delete(key);
    if (removed) {
      logger.debug(`Unregistered command: ${key}`);
    }
  }

  /**
   * Unregister all commands with a given scope.
   *
   * Used for cleanup when a plugin or MCP server is unloaded.
   */
  unregisterByScope(scope: ToolOwner): void {
    let count = 0;
    for (const [key, command] of this.commands) {
      if (command.scope === scope) {
        this.commands.delete(key);
        count++;
      }
    }
    if (count > 0) {
      logger.debug(`Unregistered ${count} commands with scope ${scope}`);
    }
  }

  /**
   * Execute a command from raw input.
   *
   * Parses the input string for the `/command args...` format.
   * Returns null if the input is not a recognized command.
   *
   * @param input - Raw input string (e.g. "/help", "/role list", "/plugin enable myplugin")
   * @param context - Command execution context
   * @returns Command output string, or null if not a valid command
   */
  async execute(input: string, context: CommandContext): Promise<string | null> {
    const resolved = this.resolve(input);
    if (!resolved) {
      return null;
    }

    return this.executeResolved(resolved, context);
  }

  async executeResolved(resolved: ResolvedCommand, context: CommandContext): Promise<string> {
    try {
      return await resolved.command.execute(resolved.args, context);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Command "${resolved.registryKey}" failed: ${message}`);
      return `Error executing command: ${message}`;
    }
  }

  resolve(input: string): ResolvedCommand | null {
    return this.resolveCommand(input);
  }

  /**
   * Check if the input string is a valid slash command.
   *
   * Returns true if input starts with "/" and the command exists
   * in the registry. Does NOT execute the command.
   */
  isCommand(input: string): boolean {
    return this.resolve(input) !== null;
  }

  /** Get all registered commands. */
  getAll(): CommandDefinition[] {
    return [...this.commands.values()];
  }

  private resolveCommand(input: string): ResolvedCommand | null {
    const trimmed = input.trim();
    if (!trimmed.startsWith('/')) {
      return null;
    }

    const parts = trimmed.slice(1).split(/\s+/);
    if (parts.length === 0 || parts[0] === '') {
      return null;
    }

    const commandName = parts[0].toLowerCase();
    const args = parts.slice(1);

    const direct = this.commands.get(commandName);
    if (direct) {
      return this.toResolvedCommand(direct, args, commandName, commandName);
    }

    if (args.length > 0) {
      const subcommandName = args[0].toLowerCase();
      const registryKey = CommandRegistry.registryKeyForParts(subcommandName, commandName);
      const namespaced = this.commands.get(registryKey);
      if (namespaced) {
        return this.toResolvedCommand(namespaced, args.slice(1), commandName, registryKey);
      }
    }

    return null;
  }

  private toResolvedCommand(
    command: CommandDefinition,
    args: string[],
    commandName: string,
    registryKey: string,
  ): ResolvedCommand {
    return { command, args, commandName, registryKey };
  }
}
