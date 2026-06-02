import { deepmergeCustom } from 'deepmerge-ts';

const mergeWithArrayReplace = deepmergeCustom({ mergeArrays: false });

/**
 * 将任意错误对象转为字符串消息。
 *
 * @param error - 捕获的错误对象
 * @returns 错误消息字符串
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
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
