/**
 * 命令注册表 — 管理命令注册与执行。
 *
 * 命令是面向用户的斜杠命令，如 /help、/role list 等。
 * 它们以作用域（ToolOwner）注册，以便在所属子系统卸载时自动清理。
 *
 */

import type { ToolOwner, CommandDefinition, CommandContext } from '../core/types';
import { createScopedLogger } from '../core/logger';

const logger = createScopedLogger('command-registry');

export type ResolvedCommand = {
  command: CommandDefinition;
  args: string[];
  commandName: string;
  /** 用于唯一标识和清理的内部注册表键。 */
  registryKey: string;
};

/**
 * 所有斜杠命令的中央注册表。
 *
 * 命令以作用域注册，以便基于所有者进行清理。
 * 注册表强制注册键的唯一性 — 尝试使用已存在的注册键注册命令将抛出错误。
 *
 * 注册键格式（仅内部使用；面向用户的语法仍保持斜杠分隔）：
 *   - 如果设置了命名空间：`namespace:name`
 *   - 否则：仅 `name`
 */
export class CommandRegistry {
  private commands: Map<string, CommandDefinition> = new Map();

  /**
   * 计算命令的内部注册表键。
   *
   * 如果命令具有命名空间，注册键为 `namespace:name`。
   * 否则，仅为 `name`。
   */
  private static registryKeyForCommand(command: CommandDefinition): string {
    return command.namespace ? `${command.namespace}:${command.name}` : command.name;
  }

  private static registryKeyForParts(name: string, namespace?: string): string {
    return namespace ? `${namespace}:${name}` : name;
  }

  /**
   * 注册一个命令。
   *
   * @throws Error 如果已存在具有相同注册键的命令
   */
  register(command: CommandDefinition): void {
    const key = CommandRegistry.registryKeyForCommand(command);
    if (this.commands.has(key)) {
      throw new Error(`命令 "${key}" 已注册`);
    }
    this.commands.set(key, command);
    logger.debug(`已注册命令: ${key} (作用域: ${command.scope})`);
  }

  /**
   * 按名称和可选命名空间注销命令。
   *
   * 如果命令不存在，则不执行任何操作。
   */
  unregister(name: string, namespace?: string): void {
    const key = CommandRegistry.registryKeyForParts(name, namespace);
    const removed = this.commands.delete(key);
    if (removed) {
      logger.debug(`已注销命令: ${key}`);
    }
  }

  /**
   * 注销指定作用域的所有命令。
   *
   * 在插件或 MCP 服务器卸载时用于清理。
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
      logger.debug(`已注销 ${count} 个作用域为 ${scope} 的命令`);
    }
  }

  /**
   * 从原始输入执行命令。
   *
   * 解析输入字符串的 `/command args...` 格式。
   * 如果输入不是已识别的命令，则返回 null。
   *
   * @param input - 原始输入字符串（例如 "/help"、"/role list"、"/plugin enable myplugin"）
   * @param context - 命令执行上下文
   * @returns 命令输出字符串，如果不是有效命令则返回 null
   */
  async execute(input: string, context: CommandContext): Promise<string | null> {
    const resolved = this.resolve(input);
    if (!resolved) {
      return null;
    }

    return await this.executeResolved(resolved, context);
  }

  /**
   * 执行已解析的命令。
   *
   * @param resolved - 已解析的命令对象
   * @param context - 命令执行上下文
   * @returns 命令输出字符串
   */
  async executeResolved(resolved: ResolvedCommand, context: CommandContext): Promise<string> {
    try {
      return await resolved.command.execute(resolved.args, context);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`命令 "${resolved.registryKey}" 执行失败: ${message}`);
      return `执行命令时出错: ${message}`;
    }
  }

  /**
   * 解析输入字符串为 ResolvedCommand。
   *
   * @param input - 原始输入字符串
   * @returns 解析后的命令对象，如果不是有效命令则返回 null
   */
  resolve(input: string): ResolvedCommand | null {
    return this.resolveCommand(input);
  }

  /**
   * 检查输入字符串是否为有效的斜杠命令。
   *
   * 如果输入以 "/" 开头且命令存在于注册表中，则返回 true。
   * 不会执行命令。
   */
  isCommand(input: string): boolean {
    return this.resolve(input) !== null;
  }

  /** 获取所有已注册的命令。 */
  getAll(): CommandDefinition[] {
    return [...this.commands.values()];
  }

  private resolveCommand(input: string): ResolvedCommand | null {
    const trimmed = input.trim();
    if (!trimmed.startsWith('/')) {
      return null;
    }

    const parts = trimmed.slice(1).split(/\s+/);
    const first = parts[0];
    if (first === undefined || first === '') {
      return null;
    }

    const commandName = first.toLowerCase();
    const args = parts.slice(1);

    const direct = this.commands.get(commandName);
    if (direct) {
      return this.toResolvedCommand(direct, args, commandName, commandName);
    }

    if (args.length > 0) {
      const second = args[0];
      if (second !== undefined) {
        const subcommandName = second.toLowerCase();
        const registryKey = CommandRegistry.registryKeyForParts(subcommandName, commandName);
        const namespaced = this.commands.get(registryKey);
        if (namespaced) {
          return this.toResolvedCommand(namespaced, args.slice(1), commandName, registryKey);
        }
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
