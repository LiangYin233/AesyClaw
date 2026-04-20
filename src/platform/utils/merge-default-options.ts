/** @file 默认选项合并工具
 *
 * 递归合并默认选项与用户选项，对象属性深度合并，
 * 非对象属性（包括数组）直接以用户值覆盖默认值。
 */

/** 判断值是否为纯对象（非数组、非 Date） */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

/** 合并默认选项与用户选项
 *
 * 对象属性递归合并，其他类型（含数组）直接以用户值覆盖。
 */
export function mergeDefaultOptions(
  defaultOptions: Record<string, unknown> = {},
  userOptions?: Record<string, unknown>
): Record<string, unknown> {
  const merged = { ...defaultOptions };

  if (!userOptions) {
    return merged;
  }

  for (const key in userOptions) {
    if (Object.hasOwn(userOptions, key)) {
      const userValue = userOptions[key];
      const defaultValue = defaultOptions[key];

      if (isPlainObject(userValue) && isPlainObject(defaultValue)) {
        merged[key] = { ...defaultValue, ...userValue };
      } else {
        merged[key] = userValue;
      }
    }
  }

  return merged;
}
