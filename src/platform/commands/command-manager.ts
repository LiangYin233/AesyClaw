/** @file 命令管理器
 *
 * CommandManager 管理命令的注册、查询与反注册，支持：
 * - 按所有者（system/plugin）隔离的命令注册作用域
 * - 命令别名映射（大小写不敏感）
 * - 命名空间前缀（插件命令自动加 plugin: 前缀）
 * - 按后缀模糊匹配（如输入 "help" 可匹配 "system:help"）
 *
 * 注册流程：
 * 1. createScope() 创建注册作用域
 * 2. scope.register() / registerMany() 注册命令
 * 3. scope.dispose() 或 unregister() 反注册
 */

import { logger } from '@/platform/observability/logger.js';
import { OwnedNameRegistry } from '@/platform/registration/owned-name-registry.js';
import {
  type RegistrationHandle,
  type RegistrationOwner,
  getRegistrationOwnerKey,
} from '@/platform/registration/types.js';
import type { CommandDefinition } from '@/contracts/commands.js';

/** 命令目录，提供命令查询接口 */
export interface CommandCatalog {
  getCommand(name: string): CommandDefinition | undefined;
  getAllCommands(): CommandDefinition[];
  getSystemCommands(): CommandDefinition[];
  getPluginCommands(): CommandDefinition[];
  getCommandsByCategory(category: 'system' | 'plugin'): CommandDefinition[];
  hasCommand(name: string): boolean;
  getCommandCount(): number;
}

/** 命令注册作用域
 *
 * 每个所有者（插件/系统）通过此接口注册和管理自己的命令。
 * dispose() 时自动反注册该所有者下的所有命令。
 */
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

/** 命令管理器
 *
 * 实现 CommandCatalog 接口，管理所有已注册命令。
 */
export class CommandManager implements CommandCatalog {
  private commands: Map<string, RegisteredCommandRecord> = new Map();
  private aliasMap: Map<string, string> = new Map();
  private ownerCommandNames = new OwnedNameRegistry();

  constructor() {
    logger.info({}, 'CommandManager initialized');
  }

  /** 为指定所有者创建命令注册作用域 */
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

  /** 通过后缀模糊匹配命令（如 "help" 匹配 "system:help"） */
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

  /** 通过名称或别名获取命令 */
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
    return this.ownerCommandNames.list(owner);
  }

  private trackOwnerName(owner: RegistrationOwner, commandName: string): void {
    this.ownerCommandNames.add(owner, commandName);
  }

  private untrackOwnerName(owner: RegistrationOwner, commandName: string): void {
    this.ownerCommandNames.remove(owner, commandName);
  }

  private toStoredName(name: string, namespace?: string): string {
    if (!namespace) {
      return name;
    }

    return name.startsWith(`${namespace}:`) ? name : `${namespace}:${name}`;
  }
}
