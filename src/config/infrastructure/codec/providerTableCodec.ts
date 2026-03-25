function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function flattenProviderModelTables(config: unknown): unknown {
  if (!isRecord(config)) {
    return config;
  }

  const next = structuredClone(config) as Record<string, unknown>;
  const providers = next.providers;
  if (!isRecord(providers)) {
    return next;
  }

  for (const provider of Object.values(providers)) {
    if (!isRecord(provider) || !isRecord(provider.models)) {
      continue;
    }

    const models = provider.models;
    delete provider.models;
    for (const [modelName, modelConfig] of Object.entries(models)) {
      provider[modelName] = modelConfig;
    }
  }

  return next;
}

type SerializableValue = string | number | boolean | null | SerializableValue[] | { [key: string]: SerializableValue };

function stripUndefined(value: unknown): SerializableValue | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value as string | boolean | null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => stripUndefined(item))
      .filter((item): item is SerializableValue => item !== undefined);
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const result: Record<string, SerializableValue> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    const normalized = stripUndefined(nestedValue);
    if (normalized !== undefined) {
      result[key] = normalized;
    }
  }

  return result;
}

export function toSerializableConfig(config: unknown): Record<string, unknown> {
  return (stripUndefined(flattenProviderModelTables(config)) ?? {}) as Record<string, unknown>;
}
