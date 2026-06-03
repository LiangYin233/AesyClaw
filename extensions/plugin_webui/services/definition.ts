const FRONTEND_DEFINITION_KEYS = ['name', 'version', 'description', 'configSchema', 'permissions'] as const;

export function serializeDefinition(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const result: Record<string, unknown> = {};
  for (const key of FRONTEND_DEFINITION_KEYS) {
    const item = value[key];
    if (item === undefined || typeof item === 'function') continue;
    result[key] = stripFunctions(item);
  }
  return result;
}

function stripFunctions(value: unknown): unknown {
  if (typeof value === 'function') return undefined;
  if (Array.isArray(value)) return value.map(stripFunctions);
  if (!isRecord(value)) return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'function') continue;
    result[key] = stripFunctions(item);
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
