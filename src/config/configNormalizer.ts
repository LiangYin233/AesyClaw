function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeConfigInput(config: unknown): unknown {
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
