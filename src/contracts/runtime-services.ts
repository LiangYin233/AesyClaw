/** @file 运行时服务接口定义
 *
 * 定义各核心服务的抽象接口，用于依赖注入与解耦。
 * 具体实现类（如 ConfigManager、RoleManager）通过这些接口被引用，
 * 使消费方不依赖具体实现细节。
 */

import type { AgentSkill } from 'aesyiu';
import type { FullConfig } from '@/features/config/schema.js';
import type { CronExecutor } from '@/features/cron/types.js';
import type { RoleConfig, RoleWithMetadata } from '@/features/roles/types.js';
import type { ChatKey, ChatSession } from '@/platform/db/repositories/session-repository.js';
import type { StandardMessage } from '@/platform/llm/types.js';

/** 配置源，提供当前完整配置的只读访问 */
export interface ConfigSource {
    getConfig(): FullConfig;
}

/** 角色目录，提供角色列表的基本查询 */
export interface RoleCatalog {
    getRolesList(): Array<{ id: string; name: string; description: string }>;
}

/** 角色存储，提供角色查询与工具权限过滤 */
export interface RoleStore extends RoleCatalog {
    /** 获取角色完整信息（含元数据），不存在时返回 null */
    getRole(roleId: string): RoleWithMetadata | null;
    /** 获取角色配置，不存在时回退到默认角色 */
    getRoleConfig(roleId: string): RoleConfig;
    /** 获取所有已加载的角色 */
    getAllRoles(): RoleWithMetadata[];
    /** 获取角色允许使用的工具名列表 */
    getAllowedTools(roleId: string, allTools: string[]): string[];
    /** 判断指定工具是否对角色可用 */
    isToolAllowed(roleId: string, toolName: string): boolean;
}

/** 技能存储，提供技能查询 */
export interface SkillStore {
    isInitialized(): boolean;
    /** 获取指定技能 ID 列表对应的技能对象 */
    getSkillsForRole(skillIds: string[]): AgentSkill[];
}

/** 聊天会话持久化存储 */
export interface ChatSessionStore {
    get(key: ChatKey): ChatSession | null;
    create(key: ChatKey): ChatSession;
    updateRole(key: ChatKey, roleId: string): void;
    getMessages(key: ChatKey): StandardMessage[];
    saveMessages(key: ChatKey, messages: StandardMessage[]): void;
    count(): number;
}

/** 路径解析服务，负责初始化与查询项目路径 */
export interface PathResolverService {
    initialize(): void;
    isInitialized(): boolean;
}

/** 配置管理服务
 *
 * 基于 c12 实现热重载配置管理，支持默认值注册与配置变更监听。
 * selfUpdating 守卫防止写入配置文件时触发自身的热重载回调。
 */
export interface ConfigManagerService {
    initialize(): Promise<void>;
    isInitialized(): boolean;
    readonly config: FullConfig;
    /** 将所有已注册的默认值同步到配置文件 */
    syncAllDefaultConfigs(): Promise<void>;
    /** 注册配置变更监听器，返回取消监听函数 */
    onConfigChange(
        listener: (_next: FullConfig, _prev: FullConfig) => void | Promise<void>,
    ): () => void;
    destroy(): Promise<void>;
}

/** SQLite 数据库管理服务 */
export interface SQLiteManagerService {
    initialize(): void;
    close(): void;
    isInitialized(): boolean;
}

/** 角色管理服务，扩展 RoleStore 增加生命周期管理 */
export interface RoleManagerService extends RoleStore {
    initialize(): Promise<void>;
    shutdown(): void;
    isInitialized(): boolean;
}

/** 技能管理服务，扩展 SkillStore 增加生命周期管理与统计 */
export interface SkillManagerService extends SkillStore {
    initialize(): Promise<void>;
    shutdown(): Promise<void>;
    getStats(): Record<string, unknown>;
}

/** Cron 调度服务运行时接口 */
export interface CronServiceRuntime {
    /** 设置任务执行器（在启动前调用） */
    setExecutor(executor: CronExecutor): void;
    start(): void;
    stop(): Promise<void>;
    isRunning(): boolean;
    getScheduledTaskCount(): number;
}
