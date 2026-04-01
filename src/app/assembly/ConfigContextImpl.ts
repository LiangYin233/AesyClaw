import type { ConfigContext, ConfigAccessor } from '../../platform/context/index.js';
import type { IConfigAccessor } from '../../platform/context/FeatureInterfaces.js';
import type { ConfigChangeListener } from '../../platform/context/ConfigAccessor.js';
import type { Config } from '../../types.js';

export function createConfigContext(
  getConfig: () => Config,
  updateConfig: (mutator: (config: Config) => Config | void) => Promise<Config>,
  onChange?: (listener: ConfigChangeListener) => () => void
): ConfigContext & ConfigAccessor & IConfigAccessor {
  return {
    getConfig,
    updateConfig,
    get<T>(key: string): T | undefined {
      const config = getConfig();
      const parts = key.split('.');
      let current: any = config;
      for (const part of parts) {
        if (current === undefined || current === null) {
          return undefined;
        }
        current = current[part];
      }
      return current as T;
    },
    getRequired<T>(key: string): T {
      const value = this.get<T>(key);
      if (value === undefined) {
        throw new Error(`Configuration key "${key}" is required but not found`);
      }
      return value;
    },
    onChange(listener: ConfigChangeListener): () => void {
      return onChange ? onChange(listener) : () => {};
    }
  };
}
