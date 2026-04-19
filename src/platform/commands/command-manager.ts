import { logger } from '@/platform/observability/logger.js';
import {
  type RegistrationHandle,
  type RegistrationOwner,
  getRegistrationOwnerKey,
} from '@/platform/registration/types.js';
import type { CommandDefinition } from '@/contracts/commands.js';

export interface CommandCatalog {
  getCommand(name: string): CommandDefinition | undefined;
  getAllCommands(): CommandDefinition[];
  getSystemCommands(): CommandDefinition[];
  getPluginCommands(): CommandDefinition[];
  getCommandsByCategory(category: 'system' | 'plugin'): CommandDefinition[];
  hasCommand(name: string): boolean;
  getCommandCount(): number;
}

export interface CommandRegistrationScope {
  readonly owner: RegistrationOwner;
  register(command: CommandDefinition): RegistrationHandle;
  registerMany(commands: readonly CommandDefinition[]): RegistrationHandle[];
  unregister(name: string): boolean;
  listOwnedNames(): string[];
  dispose(): void;
}

interface CommandScopeOptions {
  namespace?: string;
}

interface RegisteredCommandRecord {
  command: CommandDefinition;
  owner: RegistrationOwner;
  aliasKeys: string[];
}

export class CommandManager implements CommandCatalog {
  private commands: Map<string, RegisteredCommandRecord> = new Map();
  private aliasMap: Map<string, string> = new Map();
  private ownerCommandNames: Map<string, Set<string>> = new Map();

  constructor() {
    logger.info({}, 'CommandManager initialized');
  }

  createScope(owner: RegistrationOwner, options: CommandScopeOptions = {}): CommandRegistrationScope {
    return {
      owner,
      register: (command) => this.register(owner, command, options),
      registerMany: (commands) => commands.map(command => this.register(owner, command, options)),
      unregister: (name) => this.unregister(name, owner, options),
      listOwnedNames: () => this.listOwnedNames(owner),
      dispose: () => {
        this.unregisterAll(owner);
      },
    };
  }

  private resolveNamespacedCommandBySuffix(name: string): CommandDefinition | undefined {
    const target = name.toLowerCase();
    let matched: CommandDefinition | undefined;

    for (const { command } of this.commands.values()) {
      const separatorIndex = command.name.indexOf(':');
      if (separatorIndex < 0) {
        continue;
      }

      const suffix = command.name.slice(separatorIndex + 1).toLowerCase();
      if (suffix !== target) {
        continue;
      }

      if (matched) {
        return undefined;
      }

      matched = command;
    }

    return matched;
  }

  getCommand(name: string): CommandDefinition | undefined {
    const resolvedName = this.aliasMap.get(name.toLowerCase()) ?? name;
    return this.commands.get(resolvedName)?.command ?? this.resolveNamespacedCommandBySuffix(name);
  }

  getAllCommands(): CommandDefinition[] {
    return Array.from(this.commands.values(), ({ command }) => command);
  }

  getSystemCommands(): CommandDefinition[] {
    return this.getCommandsByCategory('system');
  }

  getPluginCommands(): CommandDefinition[] {
    return this.getCommandsByCategory('plugin');
  }

  getCommandsByCategory(category: 'system' | 'plugin'): CommandDefinition[] {
    return this.getAllCommands().filter(command => command.category === category);
  }

  hasCommand(name: string): boolean {
    return this.aliasMap.has(name.toLowerCase()) || this.commands.has(name) || Boolean(this.resolveNamespacedCommandBySuffix(name));
  }

  getCommandCount(): number {
    return this.commands.size;
  }

  private register(
    owner: RegistrationOwner,
    command: CommandDefinition,
    options: CommandScopeOptions
  ): RegistrationHandle {
    const storedName = this.toStoredName(command.name, options.namespace);
    if (this.commands.has(storedName) || this.aliasMap.has(storedName.toLowerCase())) {
      throw new Error(`Command "${storedName}" is already registered`);
    }

    const aliasKeys = [storedName.toLowerCase()];
    for (const alias of command.aliases ?? []) {
      const aliasKey = alias.toLowerCase();
      if (this.aliasMap.has(aliasKey) || this.commands.has(aliasKey)) {
        throw new Error(`Command alias "${alias}" conflicts with an existing command`);
      }
      aliasKeys.push(aliasKey);
    }

    const storedCommand = storedName === command.name
      ? command
      : {
          ...command,
          name: storedName,
        };

    this.commands.set(storedName, {
      command: storedCommand,
      owner,
      aliasKeys,
    });

    for (const aliasKey of aliasKeys) {
      this.aliasMap.set(aliasKey, storedName);
    }

    this.trackOwnerName(owner, storedName);

    logger.info(
      {
        commandName: storedName,
        ownerKind: owner.kind,
        ownerId: owner.id,
        category: storedCommand.category,
      },
      'Command registered'
    );

    return {
      name: storedName,
      owner,
      dispose: () => this.unregister(storedName, owner, options),
    };
  }

  private unregister(
    name: string,
    owner?: RegistrationOwner,
    options: CommandScopeOptions = {}
  ): boolean {
    const storedName = this.toStoredName(name, options.namespace);
    const record = this.commands.get(storedName);
    if (!record) {
      return false;
    }

    if (owner && getRegistrationOwnerKey(record.owner) !== getRegistrationOwnerKey(owner)) {
      return false;
    }

    const deleted = this.commands.delete(storedName);
    if (!deleted) {
      return false;
    }

    for (const aliasKey of record.aliasKeys) {
      if (this.aliasMap.get(aliasKey) === storedName) {
        this.aliasMap.delete(aliasKey);
      }
    }

    this.untrackOwnerName(record.owner, storedName);

    logger.info(
      {
        commandName: storedName,
        ownerKind: record.owner.kind,
        ownerId: record.owner.id,
      },
      'Command unregistered'
    );

    return true;
  }

  private unregisterAll(owner: RegistrationOwner): void {
    for (const commandName of this.listOwnedNames(owner)) {
      this.unregister(commandName, owner);
    }
  }

  private listOwnedNames(owner: RegistrationOwner): string[] {
    return Array.from(this.ownerCommandNames.get(getRegistrationOwnerKey(owner)) ?? []);
  }

  private trackOwnerName(owner: RegistrationOwner, commandName: string): void {
    const ownerKey = getRegistrationOwnerKey(owner);
    const names = this.ownerCommandNames.get(ownerKey) ?? new Set<string>();
    names.add(commandName);
    this.ownerCommandNames.set(ownerKey, names);
  }

  private untrackOwnerName(owner: RegistrationOwner, commandName: string): void {
    const ownerKey = getRegistrationOwnerKey(owner);
    const names = this.ownerCommandNames.get(ownerKey);
    if (!names) {
      return;
    }

    names.delete(commandName);
    if (names.size === 0) {
      this.ownerCommandNames.delete(ownerKey);
    }
  }

  private toStoredName(name: string, namespace?: string): string {
    if (!namespace) {
      return name;
    }

    return name.startsWith(`${namespace}:`) ? name : `${namespace}:${name}`;
  }
}
