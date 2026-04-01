/**
 * Feature 模块间共享接口定义
 *
 * 本文件定义了 Features 模块之间需要共享的接口，
 * 用于解耦 Features 之间的直接依赖关系。
 *
 * 架构规则：
 * - Features 之间禁止直接引用
 * - 应通过这些共享接口进行通信
 */

/**
 * 内存服务接口
 * 供其他 Features（如 sessions）使用
 */
export interface IMemoryService {
  storeMemory(sessionId: string, content: string): Promise<void>;
  retrieveMemory(sessionId: string): Promise<string[]>;
}

/**
 * Skills 管理器接口
 * 供 agents 等 Features 使用
 */
export interface ISkillManager {
  listSkills(): Promise<SkillInfo[]>;
}

/**
 * 配置访问器接口
 * 供所有 Features 访问配置
 */
export interface IConfigAccessor {
  get<T>(key: string): T | undefined;
  getRequired<T>(key: string): T;
}

// 类型定义
export interface SkillInfo {
  name: string;
  description?: string;
  enabled: boolean;
  builtin: boolean;
  source?: string;
}
