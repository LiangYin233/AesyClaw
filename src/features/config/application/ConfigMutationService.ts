import { randomBytes } from 'crypto';
import type { Config } from '../schema.js';
import { createDefaultConfig } from '../schema.js';
import { TomlConfigCodec } from '../infrastructure/codec/TomlConfigCodec.js';

export type ConfigMutator = (config: Config) => void | Config | Promise<void | Config>;

function cloneConfig(config: Config): Config {
  return structuredClone(config);
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
