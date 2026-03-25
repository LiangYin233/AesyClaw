import type { Config } from './schema.js';
import type { ConfigMutator } from './application/ConfigMutationService.js';
import { sharedConfigService } from './sharedService.js';

const defaultService = sharedConfigService;

export class ConfigLoader {
  static setPath(configPath: string): void {
    defaultService.setPath(configPath);
  }

  static async save(config: unknown): Promise<void> {
    await defaultService.save(config);
  }

  static async update(mutator: ConfigMutator): Promise<Config> {
    return defaultService.update(mutator);
  }

  static async load(configPath?: string): Promise<Config> {
    return defaultService.load(configPath);
  }

  static get(): Config {
    return defaultService.get();
  }

  static onReload(listener: (previousConfig: Config | null, nextConfig: Config) => void | Promise<void>): () => void {
    return defaultService.onReload(listener);
  }

  static startWatching(): void {
    defaultService.startWatching();
  }

  static stopWatching(): void {
    defaultService.stopWatching();
  }
}

export function getConfig(): Config {
  return ConfigLoader.get();
}

export { configSchema, DEFAULT_CONFIG, createDefaultConfig, parseConfig } from './schema.js';
export type { ConfigMutator };
