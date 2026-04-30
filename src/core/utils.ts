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
): Record<string, unknown> {
  const merged = structuredClone(defaults) as Record<string, unknown>;

  for (const [key, value] of Object.entries(overrides)) {
    const defaultValue = merged[key];
    merged[key] = isRecord(defaultValue) && isRecord(value)
      ? mergeDefaults(defaultValue, value)
      : structuredClone(value);
  }

  return merged;
}
