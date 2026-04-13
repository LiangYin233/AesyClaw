import { logger } from '@/platform/observability/logger.js';
import { CommandDefinition } from './types.js';

export class CommandRegistry {
  private static instance: CommandRegistry;
  private commands: Map<string, CommandDefinition> = new Map();
  private aliasMap: Map<string, string> = new Map();
  private pluginCommands: Map<string, CommandDefinition[]> = new Map();

  private constructor() {
    logger.info('CommandRegistry singleton initialized');
  }

  static getInstance(): CommandRegistry {
    if (!CommandRegistry.instance) {
      CommandRegistry.instance = new CommandRegistry();
    }
    return CommandRegistry.instance;
  }

  register(command: CommandDefinition): void {
    if (this.commands.has(command.name)) {
      logger.warn({ commandName: command.name }, '命令已存在，将被覆盖');
    }

    this.commands.set(command.name, command);

    if (command.aliases) {
      for (const alias of command.aliases) {
        this.aliasMap.set(alias.toLowerCase(), command.name);
      }
    }

    logger.info(
      { commandName: command.name, category: command.category },
      '命令已注册'
    );
  }

  unregister(name: string): boolean {
    const command = this.commands.get(name);
    if (!command) {
      return false;
    }

    if (command.aliases) {
      for (const alias of command.aliases) {
        this.aliasMap.delete(alias.toLowerCase());
      }
    }

    const deleted = this.commands.delete(name);
    if (deleted) {
      logger.info({ commandName: name }, 'Command unregistered');
    }
    return deleted;
  }

  registerFromPlugin(pluginName: string, commands: CommandDefinition[]): void {
    for (const command of commands) {
      const namespacedName = `${pluginName}:${command.name}`;
      const namespacedCommand: CommandDefinition = {
        ...command,
        name: namespacedName,
      };

      this.commands.set(namespacedName, namespacedCommand);

      if (command.aliases) {
        for (const alias of command.aliases) {
          this.aliasMap.set(alias.toLowerCase(), namespacedName);
        }
      }

      logger.info(
        { pluginName, commandName: namespacedName },
        '插件命令已注册'
      );
    }

    this.pluginCommands.set(pluginName, commands.map(c => ({
      ...c,
      name: `${pluginName}:${c.name}`,
    })));
  }

  unregisterFromPlugin(pluginName: string): void {
    const commands = this.pluginCommands.get(pluginName);
    if (!commands) {
      return;
    }

    for (const command of commands) {
      const namespacedName = `${pluginName}:${command.name}`;
      this.unregister(namespacedName);
    }

    this.pluginCommands.delete(pluginName);
    logger.info({ pluginName }, 'Plugin commands unregistered');
  }

  getCommand(name: string): CommandDefinition | undefined {
    const resolvedName = this.aliasMap.get(name.toLowerCase()) || name;
    return this.commands.get(resolvedName);
  }

  getAllCommands(): CommandDefinition[] {
    return Array.from(this.commands.values());
  }

  getSystemCommands(): CommandDefinition[] {
    return this.getCommandsByCategory('system');
  }

  getPluginCommands(): CommandDefinition[] {
    return this.getCommandsByCategory('plugin');
  }

  getCommandsByCategory(category: 'system' | 'plugin'): CommandDefinition[] {
    return Array.from(this.commands.values()).filter(
      cmd => cmd.category === category
    );
  }

  hasCommand(name: string): boolean {
    return this.commands.has(name) || this.aliasMap.has(name.toLowerCase());
  }

  clearAll(): void {
    this.commands.clear();
    this.aliasMap.clear();
    this.pluginCommands.clear();
    logger.info('All commands cleared');
  }

  getCommandCount(): number {
    return this.commands.size;
  }
}

export const commandRegistry = CommandRegistry.getInstance();
