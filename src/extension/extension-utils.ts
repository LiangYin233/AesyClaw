/** 频道和插件扩展共享的运行时校验工具。 */

import { isRecord } from '@aesyclaw/core/utils';

/**
 * 校验未知值的扩展基础结构（name、version、init、destroy 等）。
 *
 * 返回已验证的记录以便调用方继续使用；校验失败则返回 `false`。
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
