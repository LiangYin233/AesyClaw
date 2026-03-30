// src/app/assembly/ConfigContextImpl.ts
import type { ConfigContext } from '../../platform/context/ConfigContext.js';
import type { Config } from '../../types.js';

export function createConfigContext(
  getConfig: () => Config,
  updateConfig: (mutator: (config: Config) => void | Config | Promise<void | Config>) => Promise<Config>
): ConfigContext {
  return {
    getConfig,
    updateConfig
  };
}
