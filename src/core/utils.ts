/** Shared small utilities for backend managers and runtime helpers. */

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function mergeDefaults(
  defaults: Record<string, unknown>,
  overrides: Record<string, unknown>,
  options: { overwrite?: boolean } = {},
): Record<string, unknown> {
  const merged = structuredClone(defaults) as Record<string, unknown>;
  const overwrite = options.overwrite ?? true;

  for (const key of Object.keys(overrides)) {
    const sourceVal = overrides[key];
    const targetVal = merged[key];

    if (
      sourceVal !== null &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      targetVal !== null &&
      typeof targetVal === 'object' &&
      !Array.isArray(targetVal)
    ) {
      merged[key] = mergeDefaults(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
        options,
      );
    } else if (targetVal === undefined || overwrite) {
      merged[key] = structuredClone(sourceVal as unknown);
    }
  }

  return merged;
}
