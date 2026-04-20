/** @file 命令与插件配置合约
 *
 * 定义命令系统的核心类型（CommandDefinition、CommandContext、CommandResult）
 * 以及插件配置存储接口（PluginConfigStore），用于命令注册与插件运行时配置管理。
 */

import type { CommandRegistrationScope } from '@/platform/commands/command-manager.js';

/** 命令定义，描述一个可执行的命令及其元信息 */
export interface CommandDefinition {
    name: string;
    description: string;
    usage: string;
    aliases?: string[];
    category: 'system' | 'plugin';
    execute: (_ctx: CommandContext) => Promise<CommandResult>;
}

/** 命令执行上下文，携带当前会话与解析后的参数 */
export interface CommandContext {
    chatId: string;
    channelId: string;
    messageType: string;
    args: string[];
    rawArgs: string;
}

/** 命令执行结果 */
export interface CommandResult {
    success: boolean;
    message: string;
    data?: unknown;
}

/** 解析后的命令结构 */
export interface ParsedCommand {
    name: string;
    args: string[];
    rawArgs: string;
}

/** 插件可使用的命令注册端口，取自 CommandRegistrationScope 的安全子集 */
export type PluginCommandRegistrar = Pick<
    CommandRegistrationScope,
    'register' | 'registerMany' | 'unregister' | 'listOwnedNames' | 'dispose'
>;

/** 插件运行时配置，记录启用状态与用户选项 */
export interface PluginRuntimeConfig {
    name: string;
    enabled: boolean;
    options?: Record<string, unknown>;
}

/** 配置默认值的作用域标识 */
export type ConfigDefaultsScope = 'plugin' | 'channel';

/** 插件配置存储接口
 *
 * 提供默认值注册、运行时配置查询、配置变更监听与持久化更新。
 * 实现：ConfigManager
 */
export interface PluginConfigStore {
    /** 注册插件/频道的默认配置值 */
    registerDefaults(
        scope: ConfigDefaultsScope,
        name: string,
        defaults: Record<string, unknown>,
    ): void;
    /** 查询指定插件的运行时配置 */
    getPluginRuntimeConfig(name: string): PluginRuntimeConfig | undefined;
    /** 监听插件配置变更，返回取消监听函数 */
    onPluginConfigChange(
        listener: (
            _next: readonly PluginRuntimeConfig[],
            _prev: readonly PluginRuntimeConfig[],
        ) => void | Promise<void>,
    ): () => void;
    /** 将所有已注册的默认值同步到配置文件 */
    syncAllDefaultConfigs(): Promise<void>;
    /** 更新插件的运行时配置（启用/禁用/选项）并持久化 */
    updatePluginRuntimeConfig(
        name: string,
        changes: { enabled: boolean; options?: Record<string, unknown> },
    ): Promise<boolean>;
}
