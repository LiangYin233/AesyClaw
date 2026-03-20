import { ConfigLoader } from './loader.js';
import type { Config } from '../types.js';
import type { EventBus } from '../events/EventBus.js';
import type { AesyClawEvents } from '../events/events.js';

type ConfigMutator = (config: Config) => void | Config | Promise<void | Config>;

export class ConfigManager {
  private currentConfig: Config | null = null;
  private unsubscribeLoader?: () => void;

  constructor(private readonly eventBus?: EventBus<AesyClawEvents>) {}

  async load(configPath?: string): Promise<Config> {
    this.ensureReloadBridge();
    const config = await ConfigLoader.load(configPath);
    this.currentConfig = config;
    return config;
  }

  getConfig(): Config {
    if (!this.currentConfig) {
      throw new Error('Config has not been loaded');
    }

    return this.currentConfig;
  }

  async save(config: unknown): Promise<Config> {
    this.ensureReloadBridge();
    await ConfigLoader.save(config);
    const nextConfig = ConfigLoader.get();
    this.currentConfig = nextConfig;
    return nextConfig;
  }

  async update(mutator: ConfigMutator): Promise<Config> {
    this.ensureReloadBridge();
    if (!this.currentConfig) {
      await this.load();
    }
    const nextConfig = await ConfigLoader.update(mutator);
    this.currentConfig = nextConfig;
    return nextConfig;
  }

  async updatePluginConfig(
    name: string,
    enabled: boolean,
    options?: Record<string, unknown>
  ): Promise<Config> {
    return this.update((config) => {
      config.plugins[name] = {
        ...(config.plugins[name] || {}),
        enabled,
        ...(options ? { options } : {})
      };
    });
  }

  setConfig(config: Config): void {
    this.currentConfig = config;
  }

  dispose(): void {
    this.unsubscribeLoader?.();
    this.unsubscribeLoader = undefined;
  }

  private ensureReloadBridge(): void {
    if (this.unsubscribeLoader) {
      return;
    }

    this.unsubscribeLoader = ConfigLoader.onReload(async (nextConfig) => {
      const previousConfig = this.currentConfig;
      this.currentConfig = nextConfig;
      await this.emitConfigChanged(previousConfig, nextConfig);
    });
  }

  private async emitConfigChanged(previousConfig: Config | null, currentConfig: Config): Promise<void> {
    if (!this.eventBus || !previousConfig) {
      return;
    }

    await this.eventBus.emit('config.changed', {
      previousConfig,
      currentConfig
    });
  }
}
