import { ConfigLoader } from './loader.js';
import type { Config } from '../types.js';

type ReloadListener = (previousConfig: Config | null, nextConfig: Config) => void | Promise<void>;
type ConfigMutator = (config: Config) => void | Config | Promise<void | Config>;

export class ConfigRepository {
  async load(configPath?: string): Promise<Config> {
    return ConfigLoader.load(configPath);
  }

  get(): Config {
    return ConfigLoader.get();
  }

  async save(config: unknown): Promise<void> {
    await ConfigLoader.save(config);
  }

  async update(mutator: ConfigMutator): Promise<Config> {
    return ConfigLoader.update(mutator);
  }

  onReload(listener: ReloadListener): () => void {
    return ConfigLoader.onReload(listener);
  }
}
