/**
 * CommandBuilder — 命令构建器，提供流式 API 来创建命令定义。
 *
 * 使用 Builder 模式简化命令注册，提供更清晰的 API。
 *
 * @example
 * ```typescript
 * const command = new CommandBuilder()
 *   .setName('help')
 *   .setDescription('列出所有可用命令')
 *   .setScope('system')
 *   .allowDuringAgentProcessing()
 *   .setExecutor(async () => {
 *     return { components: [{ type: 'Plain', text: '帮助信息' }] };
 *   })
 *   .build();
 * ```
 */

import type { CommandDefinition, CommandExecuteFn, ToolOwner } from '@aesyclaw/core/types';

export class CommandBuilder {
  private name?: string;
  private namespace?: string;
  private description?: string;
  private usage?: string;
  private scope?: ToolOwner;
  private allowDuringProcessing: boolean = false;
  private executor?: CommandExecuteFn;

  /**
   * 设置命令名称。
   * @param name - 命令名称
   * @returns this
   */
  setName(name: string): this {
    this.name = name;
    return this;
  }

  /**
   * 设置命令命名空间。
   * @param namespace - 命名空间
   * @returns this
   */
  setNamespace(namespace: string): this {
    this.namespace = namespace;
    return this;
  }

  /**
   * 设置命令描述。
   * @param description - 描述
   * @returns this
   */
  setDescription(description: string): this {
    this.description = description;
    return this;
  }

  /**
   * 设置命令用法说明。
   * @param usage - 用法说明
   * @returns this
   */
  setUsage(usage: string): this {
    this.usage = usage;
    return this;
  }

  /**
   * 设置命令作用域。
   * @param scope - 作用域
   * @returns this
   */
  setScope(scope: ToolOwner): this {
    this.scope = scope;
    return this;
  }

  /**
   * 允许在 Agent 处理期间执行此命令。
   * @param allow - 是否允许（默认 true）
   * @returns this
   */
  allowDuringAgentProcessing(allow: boolean = true): this {
    this.allowDuringProcessing = allow;
    return this;
  }

  /**
   * 设置命令执行器。
   * @param executor - 执行函数
   * @returns this
   */
  setExecutor(executor: CommandExecuteFn): this {
    this.executor = executor;
    return this;
  }

  /**
   * 构建命令定义。
   * @returns 命令定义
   * @throws Error 如果缺少必需字段
   */
  build(): CommandDefinition {
    if (!this.name) {
      throw new Error('命令名称是必需的');
    }
    if (!this.description) {
      throw new Error('命令描述是必需的');
    }
    if (!this.scope) {
      throw new Error('命令作用域是必需的');
    }
    if (!this.executor) {
      throw new Error('命令执行器是必需的');
    }

    const definition: CommandDefinition = {
      name: this.name,
      description: this.description,
      scope: this.scope,
      execute: this.executor,
    };

    if (this.namespace) {
      definition.namespace = this.namespace;
    }
    if (this.usage) {
      definition.usage = this.usage;
    }
    if (this.allowDuringProcessing !== undefined) {
      definition.allowDuringAgentProcessing = this.allowDuringProcessing;
    }

    return definition;
  }

  /**
   * 创建一个新的命令构建器实例。
   * @returns 新的构建器实例
   */
  static create(): CommandBuilder {
    return new CommandBuilder();
  }
}
