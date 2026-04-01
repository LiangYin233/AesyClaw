import { randomBytes } from 'crypto';
import type { Config } from '../schema/index.js';
import { createDefaultConfig } from '../schema/index.js';
import { TomlConfigCodec } from '../infrastructure/codec/TomlConfigCodec.js';

export type ConfigMutator = (config: Config) => void | Config | Promise<void | Config>;

export type ConfigSectionPath = readonly string[];

export interface DefaultConfigItem<T = unknown> {
  path: ConfigSectionPath;
  defaultValue: T;
}

function cloneConfig(config: Config): Config {
  try {
    return structuredClone(config);
  } catch {
    return JSON.parse(JSON.stringify(config)) as Config;
  }
}

function getValueByPath(obj: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = obj;
  for (const key of path) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function setValueByPath(obj: Record<string, unknown>, path: string[], value: unknown): void {
  if (path.length === 0) {
    return;
  }
  
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (!(key in current) || typeof current[key] !== 'object' || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  
  current[path[path.length - 1]] = value;
}

export function applyDefaultsIfAbsent(
  currentConfig: Config,
  defaultItems: DefaultConfigItem[]
): Config {
  const draft = cloneConfig(currentConfig) as unknown as Record<string, unknown>;
  
  for (const item of defaultItems) {
    const existingValue = getValueByPath(draft, [...item.path]);
    
    if (existingValue === undefined) {
      setValueByPath(draft, [...item.path], item.defaultValue);
    }
  }
  
  return draft as Config;
}

export class ConfigMutationService {
  constructor(private readonly codec: TomlConfigCodec) {}

  createDefaultConfig(): Config {
    return this.ensureToken(createDefaultConfig());
  }

  parsePersisted(raw: string): Config {
    return this.ensureToken(this.codec.decode(raw));
  }

  parseInput(config: unknown): Config {
    return this.ensureToken(this.codec.parseInput(config));
  }

  async applyUpdate(currentConfig: Config, mutator: ConfigMutator): Promise<Config> {
    const draft = cloneConfig(currentConfig);
    const updatedConfig = await mutator(draft);
    return this.parseInput(updatedConfig ?? draft);
  }

  serialize(config: Config): string {
    return this.codec.encode(config);
  }

  private ensureToken(config: Config): Config {
    if (config.server.token) {
      return config;
    }

    const nextConfig = cloneConfig(config);
    nextConfig.server.token = randomBytes(24).toString('hex');
    return nextConfig;
  }
}
