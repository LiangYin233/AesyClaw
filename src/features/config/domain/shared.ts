import type { Config } from '../schema.js';

export type ConfigSource = Config | { getConfig(): Config };

export function readConfig(source: ConfigSource): Config {
  if (typeof (source as { getConfig?: () => Config }).getConfig === 'function') {
    return (source as { getConfig: () => Config }).getConfig();
  }

  return source as Config;
}
