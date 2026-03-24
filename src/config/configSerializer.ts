import { stringify } from 'smol-toml';
import type { Config } from '../types.js';
import { providerReservedKeys } from './schema/providers.js';

type SerializableValue = string | number | boolean | null | SerializableValue[] | { [key: string]: SerializableValue };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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

function expandProviderModelTables(config: Config): Config {
  const next = structuredClone(config);

  for (const provider of Object.values(next.providers || {})) {
    const models = provider.models || {};

    delete (provider as { models?: unknown }).models;
    for (const [modelName, modelConfig] of Object.entries(models)) {
      (provider as Record<string, unknown>)[modelName] = modelConfig;
    }

    for (const key of providerReservedKeys) {
      if (key === 'models') {
        continue;
      }
      if ((provider as Record<string, unknown>)[key] === undefined) {
        delete (provider as Record<string, unknown>)[key];
      }
    }
  }

  return next;
}

export function serializeConfig(config: Config): string {
  const serializable = stripUndefined(expandProviderModelTables(config)) ?? {};
  return stringify(serializable as Record<string, unknown>);
}
