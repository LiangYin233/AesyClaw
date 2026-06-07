import { deepmergeCustom } from 'deepmerge-ts';

const mergeWithArrayReplace = deepmergeCustom({ mergeArrays: false });

/**
 * 类型守卫 — 检查值是否为非数组的普通对象。
 *
 * @param value - 待检查的值
 * @returns 是否为 Record<string, unknown>
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 深度比较两个对象是否相等，忽略键序差异。
 *
 * 先将对象键递归排序后再 JSON 序列化比较。
 *
 * @param a - 第一个对象
 * @param b - 第二个对象
 * @returns 是否递归相等
 */
export function objectsEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortObjectKeys(a)) === JSON.stringify(sortObjectKeys(b));
}

/** 递归排序对象键，用于忽略键序的深度比较。 */
export function sortObjectKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sortObjectKeys);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = sortObjectKeys((obj as Record<string, unknown>)[key]);
  }
  return sorted;
}

/**
 * 深度合并默认配置，支持嵌套对象递归合并。
 *
 * @param defaults - 默认配置对象
 * @param overrides - 覆盖配置对象
 * @param options - 合并选项，overwrite 为 false 时不覆盖已有值
 * @returns 合并后的新对象
 */
export function mergeDefaults(
  defaults: Record<string, unknown>,
  overrides: Record<string, unknown>,
  options: { overwrite?: boolean } = {},
): Record<string, unknown> {
  return (
    (options.overwrite ?? true)
      ? mergeWithArrayReplace(defaults, overrides)
      : mergeWithArrayReplace(overrides, defaults)
  ) as Record<string, unknown>;
}

/**
 * 解析模型标识符字符串，拆分为 provider 和 modelId。
 *
 * @param modelIdentifier - 格式为 "provider/modelId" 的标识符
 * @returns 包含 provider 和 modelId 的对象
 */
export function parseModelIdentifier(modelIdentifier: string): {
  provider: string;
  modelId: string;
} {
  const idx = modelIdentifier.indexOf('/');
  if (idx === -1)
    throw new Error(`模型标识符格式无效: "${modelIdentifier}"。应为 "provider/modelId"。`);
  return { provider: modelIdentifier.slice(0, idx), modelId: modelIdentifier.slice(idx + 1) };
}
