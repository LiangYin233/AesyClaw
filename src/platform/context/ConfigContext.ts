// src/platform/context/ConfigContext.ts
import type { Config } from '../../types.js';

export interface ConfigAccessor {
  getConfig(): Config;
}

export interface ConfigMutator {
  updateConfig(mutator: (config: Config) => void | Config | Promise<void | Config>): Promise<Config>;
}

export interface ConfigContext extends ConfigAccessor, ConfigMutator {
  // Config access methods
}

export interface ConfigReloadTargets {
  reloadChannel(channelId: string): Promise<void>;
  reloadPlugin(pluginId: string): Promise<void>;
  reloadSession(sessionKey: string): Promise<void>;
  reloadMCP(mcpId: string): Promise<void>;
}
