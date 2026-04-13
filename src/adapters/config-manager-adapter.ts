import type { IConfigManager } from '../contracts/config-manager.js';
import type { FullConfig } from '../features/config/schema.js';
import { configManager } from '../features/config/config-manager.js';

export class ConfigManagerAdapter implements IConfigManager {
  get config(): FullConfig {
    return configManager.config;
  }

  getConfig(): FullConfig {
    return configManager.getConfig();
  }

  registerChannelDefaults(channelName: string, defaults: Record<string, unknown>): void {
    configManager.registerChannelDefaults(channelName, defaults);
  }

  isInitialized(): boolean {
    return configManager.isInitialized();
  }

  async initialize(): Promise<void> {
    await configManager.initialize();
  }
}

export const configManagerAdapter = new ConfigManagerAdapter();
