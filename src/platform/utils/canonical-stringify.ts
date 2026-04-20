/** @file 规范字符串化工具
 *
 * 提供 canonicalStringify 与 hasCanonicalValueChanged 两个工具函数，
 * 用于比较两个值的深层内容是否发生变化（忽略对象键的顺序）。
 *
 * 用途：配置变更检测，避免对象键顺序不同导致的误判重载。
 */

/** 将值规范化为字符串（对象键按字母顺序排序） */
export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(',')}]`;
  }

  const keys = Object.keys(value as Record<string, unknown>).sort();
  const body = keys
    .map(key => `${JSON.stringify(key)}:${canonicalStringify((value as Record<string, unknown>)[key])}`)
    .join(',');

  return `{${body}}`;
}

/** 判断两个值的规范字符串是否不同 */
export function hasCanonicalValueChanged(previousValue: unknown, nextValue: unknown): boolean {
  return canonicalStringify(previousValue) !== canonicalStringify(nextValue);
}
