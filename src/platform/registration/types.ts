/** @file 注册所有者类型定义
 *
 * 定义注册系统中的所有者类型与相关工具函数。
 * 所有者用于标识命令/工具的注册来源（system、plugin、mcp）。
 */

/** 注册所有者类型 */
export type RegistrationOwnerKind = 'system' | 'plugin' | 'mcp';

/** 注册所有者标识 */
export interface RegistrationOwner {
    kind: RegistrationOwnerKind;
    id: string;
}

/** 注册句柄，用于后续反注册 */
export interface RegistrationHandle {
    readonly name: string;
    readonly owner: RegistrationOwner;
    dispose(): boolean;
}

/** 创建注册所有者 */
export function createRegistrationOwner(
    kind: RegistrationOwnerKind,
    id: string,
): RegistrationOwner {
    return { kind, id };
}

/** 获取注册所有者的唯一键 */
export function getRegistrationOwnerKey(owner: RegistrationOwner): string {
    return `${owner.kind}:${owner.id}`;
}
