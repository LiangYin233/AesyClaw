/** 频道和插件扩展共享的运行时校验工具。 */

import { isRecord } from '@aesyclaw/core/utils';

/**
 * 校验未知值的扩展基础结构（name、version、init、destroy 等）。
 * 返回已验证的记录以便调用方继续使用；校验失败则返回 `false`。
 *
 * @param value - 待校验的未知值
 * @returns 校验通过返回原值，失败返回 false
 */
export function validateExtension<T>(value: unknown): T | false {
  if (!isRecord(value)) {
    return false;
  }

  if (
    typeof value['name'] !== 'string' ||
    value['name'].length === 0 ||
    typeof value['version'] !== 'string' ||
    value['version'].length === 0 ||
    typeof value['init'] !== 'function' ||
    (value['destroy'] !== undefined && typeof value['destroy'] !== 'function') ||
    (value['description'] !== undefined && typeof value['description'] !== 'string') ||
    (value['defaultConfig'] !== undefined && !isRecord(value['defaultConfig']))
  ) {
    return false;
  }

  return value as T;
}

/**
 * 从记录对象中剥离 `enabled` 字段。
 *
 * 频道和插件都会在 defaultConfig 中定义 `enabled` 作为开关，
 * 但该字段由管理器统一管理，不应混入扩展自定义配置中。
 *
 * @param value - 可能包含 enabled 的记录
 * @returns 移除了 enabled 字段的记录
 */
export function stripEnabledField<T extends Record<string, unknown>>(value: T): Omit<T, 'enabled'> {
  const { enabled: _enabled, ...rest } = value;
  return rest;
}

/**
 * 从动态导入的模块中发现扩展定义。
 *
 * 按优先级检查 `default` 导出和命名导出，验证基础结构后返回。
 * 调用方再根据扩展类型（channel/plugin）进一步校验特定字段。
 *
 * @param imported - 动态导入的模块对象
 * @param exportName - 命名导出名称（'channel' 或 'plugin'）
 * @returns 验证通过的扩展定义，无效时返回 null
 */
export function discoverExtensionDefinition(
  imported: unknown,
  exportName: string,
): Record<string, unknown> | null {
  if (!isRecord(imported)) return null;
  const candidate = (imported['default'] ?? imported[exportName]) as unknown;
  if (!isRecord(candidate)) return null;
  const validated = validateExtension<Record<string, unknown>>(candidate);
  return validated === false ? null : validated;
}
