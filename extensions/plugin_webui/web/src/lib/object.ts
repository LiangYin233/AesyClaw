export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
