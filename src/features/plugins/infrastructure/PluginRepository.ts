import type { PluginManager } from '../application/PluginManager.js';
import type { PluginInfo } from '../domain/types.js';
import type { Config } from '../../../types.js';

interface PluginRepositoryDeps {
  pluginManager?: PluginManager;
  getConfig: () => Config;
  updateConfig: (mutator: (config: Config) => void | Config | Promise<void | Config>) => Promise<Config>;
}

export class PluginRepository {
  constructor(private readonly deps: PluginRepositoryDeps) {}

  async listAll(): Promise<PluginInfo[]> {
    const plugins = this.deps.pluginManager ? await this.deps.pluginManager.getAllPlugins() : [];
    return [...plugins].sort((left, right) => left.name.localeCompare(right.name));
  }

  async setEnabled(name: string, enabled: boolean): Promise<boolean> {
    const knownPluginNames = await this.getKnownPluginNames();
    if (this.deps.pluginManager && knownPluginNames.has(name)) {
      await this.deps.updateConfig((config) => {
        config.plugins[name] = {
          ...(config.plugins[name] || {}),
          enabled
        };
      });
      return true;
    }

    // 通道插件现在由 ChannelManager 直接管理，不在此处处理
    return false;
  }

  async updateOptions(name: string, options: Record<string, unknown>): Promise<boolean> {
    const knownPluginNames = await this.getKnownPluginNames();
    if (this.deps.pluginManager && knownPluginNames.has(name)) {
      const config = this.deps.getConfig();
      const currentEnabled = config.plugins[name]?.enabled ?? true;
      await this.deps.updateConfig((draft) => {
        draft.plugins[name] = {
          ...(draft.plugins[name] || {}),
          enabled: currentEnabled,
          options
        };
      });
      return true;
    }

    // 通道插件现在由 ChannelManager 直接管理，不在此处处理
    return false;
  }

  private async getKnownPluginNames(): Promise<Set<string>> {
    if (!this.deps.pluginManager) {
      return new Set<string>();
    }
    return new Set((await this.deps.pluginManager.getAllPlugins()).map((plugin) => plugin.name));
  }
}
