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
  key: string;
}

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
      logger.error(`Command "${resolved.key}" failed: ${message}`);
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
      return { command: direct, args, commandName, key: commandName };
    }

    if (args.length > 0) {
      const subcommandName = args[0].toLowerCase();
      const namespaced = this.commands.get(`${commandName}:${subcommandName}`);
      if (namespaced) {
        return {
          command: namespaced,
          args: args.slice(1),
          commandName,
          key: `${commandName}:${subcommandName}`,
        };
      }
    }

    return null;
  }
}
