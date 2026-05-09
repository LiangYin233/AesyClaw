/** 工具参数验证 — TypeBox schema 校验工具。 */

import { Kind, type TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

/**
 * 工具参数验证结果。
 *
 * 成功时包含验证后的 value，失败时包含错误信息。
 */
export type ValidationResult =
  | { success: true; value: unknown }
  | { success: false; error: string };

/**
 * 验证工具参数是否符合 schema，应用默认值并检查类型正确性。
 *
 * @param schema - TypeBox 参数 schema
 * @param params - LLM 传入的原始参数
 * @returns 验证结果，成功时 value 已应用默认值
 */
export function validateParams(
  schema: TSchema,
  params: unknown,
): ValidationResult {
  if ((schema as { [Kind]?: unknown })[Kind] === 'Unsafe') {
    return { success: true, value: params };
  }

  let withDefaults: unknown;

  try {
    withDefaults = Value.Default(schema, params);

    if (!Value.Check(schema, withDefaults)) {
      const errors = [...Value.Errors(schema, withDefaults)]
        .slice(0, 3)
        .map((e) => `${e.path}: ${e.message}`)
        .join('; ');

      return { success: false, error: errors || '未知验证错误' };
    }

    return { success: true, value: withDefaults };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message || '未知验证错误' };
  }
}