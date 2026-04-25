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

/**
 * Central registry for all slash commands.
 *
 * Commands are registered with a scope for owner-based cleanup.
 * The registry enforces key uniqueness — attempting to register a
 * command with a key that already exists throws an error.
 *
 * Command key format:
 *   - If namespace is set: `namespace:name`
 *   - Otherwise: just `name`
 */
export class CommandRegistry {
  private commands: Map<string, CommandDefinition> = new Map();

  /**
   * Compute the map key for a command.
   *
   * If the command has a namespace, the key is `namespace:name`.
   * Otherwise, just `name`.
   */
  private static commandKey(command: CommandDefinition): string {
    return command.namespace ? `${command.namespace}:${command.name}` : command.name;
  }

  /**
   * Register a command.
   *
   * @throws Error if a command with the same key already exists
   */
  register(command: CommandDefinition): void {
    const key = CommandRegistry.commandKey(command);
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
    const key = namespace ? `${namespace}:${name}` : name;
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
    const trimmed = input.trim();

    // Must start with /
    if (!trimmed.startsWith('/')) {
      return null;
    }

    // Split into parts: /command arg1 arg2 ...
    const parts = trimmed.slice(1).split(/\s+/);
    if (parts.length === 0 || parts[0] === '') {
      return null;
    }

    const commandName = parts[0].toLowerCase();
    const args = parts.slice(1);

    // Look up the command — try with namespace prefixes
    // First, try exact match (no namespace)
    let command = this.commands.get(commandName);

    // If not found, it might be a namespaced command like "role:list"
    // but users type "/role list", so we need to check subcommands
    // For namespaced commands, the key is "namespace:name"
    if (!command && args.length > 0) {
      // Try treating commandName as namespace and args[0] as the subcommand name
      const compoundKey = `${commandName}:${args[0].toLowerCase()}`;
      command = this.commands.get(compoundKey);
      if (command) {
        // Consume the first arg since it's part of the command key
        args.splice(0, 1);
      }
    }

    if (!command) {
      return null;
    }

    try {
      return await command.execute(args, context);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Command "${commandName}" failed: ${message}`);
      return `Error executing command: ${message}`;
    }
  }

  /**
   * Check if the input string is a valid slash command.
   *
   * Returns true if input starts with "/" and the command exists
   * in the registry. Does NOT execute the command.
   */
  isCommand(input: string): boolean {
    const trimmed = input.trim();
    if (!trimmed.startsWith('/')) {
      return false;
    }

    const parts = trimmed.slice(1).split(/\s+/);
    if (parts.length === 0 || parts[0] === '') {
      return false;
    }

    const commandName = parts[0].toLowerCase();

    // Direct match
    if (this.commands.has(commandName)) {
      return true;
    }

    // Check namespaced match if there's a subcommand arg
    if (parts.length > 1) {
      const compoundKey = `${commandName}:${parts[1].toLowerCase()}`;
      if (this.commands.has(compoundKey)) {
        return true;
      }
    }

    return false;
  }

  /** Get all registered commands. */
  getAll(): CommandDefinition[] {
    return [...this.commands.values()];
  }
}
