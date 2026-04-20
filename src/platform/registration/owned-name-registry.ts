/** @file 所有者名称注册表
 *
 * OwnedNameRegistry 跟踪每个注册所有者所拥有的名称（命令名/工具名），
 * 用于在作用域 dispose 时批量反注册。
 */

import { type RegistrationOwner, getRegistrationOwnerKey } from './types.js';

/** 所有者名称注册表
 *
 * 按所有者键分组存储名称集合，支持添加、移除与列出。
 */
export class OwnedNameRegistry {
  private readonly ownerNames: Map<string, Set<string>> = new Map();

  /** 列出指定所有者下的所有名称 */
  list(owner: RegistrationOwner): string[] {
    return Array.from(this.ownerNames.get(getRegistrationOwnerKey(owner)) ?? []);
  }

  /** 将名称添加到指定所有者下 */
  add(owner: RegistrationOwner, name: string): void {
    const ownerKey = getRegistrationOwnerKey(owner);
    const names = this.ownerNames.get(ownerKey) ?? new Set<string>();
    names.add(name);
    this.ownerNames.set(ownerKey, names);
  }

  /** 从指定所有者下移除名称，若名称集合为空则删除所有者键 */
  remove(owner: RegistrationOwner, name: string): void {
    const ownerKey = getRegistrationOwnerKey(owner);
    const names = this.ownerNames.get(ownerKey);
    if (!names) {
      return;
    }

    names.delete(name);
    if (names.size === 0) {
      this.ownerNames.delete(ownerKey);
    }
  }
}
