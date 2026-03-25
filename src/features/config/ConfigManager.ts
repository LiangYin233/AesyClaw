import type { Config } from './schema.js';
import type { EventBus } from '../../platform/events/EventBus.js';
import type { AesyClawEvents } from '../../platform/events/events.js';
import { ConfigService } from './application/ConfigService.js';
import type { ConfigMutator } from './application/ConfigMutationService.js';
import type { ConfigReloadTargets } from './reload/ports/ReloadTargets.js';
import { sharedConfigService } from './sharedService.js';

export class ConfigManager {
  private unsubscribeReload?: () => void;

  constructor(
    private readonly eventBus?: EventBus<AesyClawEvents>,
    private readonly service: ConfigService = sharedConfigService
  ) {}

  async load(configPath?: string): Promise<Config> {
    this.ensureReloadBridge();
    return this.service.load(configPath);
  }

  getConfig(): Config {
    return this.service.get();
  }

  getSnapshotStore() {
    return this.service.getSnapshotStore();
  }

  async save(config: unknown): Promise<Config> {
    this.ensureReloadBridge();
    return this.service.save(config);
  }

  async update(mutator: ConfigMutator): Promise<Config> {
    this.ensureReloadBridge();
    return this.service.update(mutator);
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
    this.service.setConfig(config);
  }

  setReloadTargets(targets: ConfigReloadTargets): void {
    this.service.setReloadTargets(targets);
  }

  dispose(): void {
    this.unsubscribeReload?.();
    this.unsubscribeReload = undefined;
    this.service.stopWatching();
  }

  private ensureReloadBridge(): void {
    if (this.unsubscribeReload) {
      return;
    }

    this.unsubscribeReload = this.service.onReload(async (previousConfig, currentConfig) => {
      if (!this.eventBus || !previousConfig) {
        return;
      }

      await this.eventBus.emit('config.changed', {
        previousConfig,
        currentConfig
      });
    });
  }
}
