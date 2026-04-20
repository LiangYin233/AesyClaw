import type { PluginRuntimeConfig } from '@/contracts/commands.js';
import { logger } from '@/platform/observability/logger.js';
import { PluginManager } from './plugin-manager.js';

export interface PluginRuntimeConfigSource {
  getPluginConfigs(): readonly PluginRuntimeConfig[];
}

interface PluginRuntimeDependencies {
  pluginManager: PluginManager;
  configSource: PluginRuntimeConfigSource;
}

export class PluginRuntime {
  constructor(private readonly deps: PluginRuntimeDependencies) {}

  getPluginCount(): number {
    return this.deps.pluginManager.getPluginCount();
  }

  async start(): Promise<void> {
    await this.deps.pluginManager.initialize();
    await this.deps.pluginManager.scanAndLoad(this.deps.configSource.getPluginConfigs());
    logger.info({ loadedPlugins: this.getPluginCount() }, 'Plugins system loaded');
  }

  watchConfigChanges(): void {
    this.deps.pluginManager.watchConfigChanges();
  }

  async stop(): Promise<void> {
    await this.deps.pluginManager.shutdown();
  }
}
