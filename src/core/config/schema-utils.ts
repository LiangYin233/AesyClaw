/** Schema 校验工具函数 */

import { Value } from '@sinclair/typebox/value';

/**
 * 使用 TypeBox schema 校验值，失败时抛出描述性错误。
 *
 * @param schema - TypeBox schema
 * @param value - 待校验值
 * @param label - 错误消息中的标签（如 '配置'、'角色'）
 * @returns 校验并填充默认值后的值
 */
export function validateWithSchema<T>(
  schema: Parameters<typeof Value.Check>[0],
  value: unknown,
  label: string,
): T {
  const validated = Value.Default(schema, value) as T;
  if (!Value.Check(schema, validated)) {
    const errors = [...Value.Errors(schema, validated)]
      .map((e) => `${e.path}: ${e.message}`)
      .join('; ');
    throw new Error(`${label}验证失败: ${errors}`);
  }
  return validated;
}
