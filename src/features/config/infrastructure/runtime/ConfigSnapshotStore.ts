import type { Config } from '../../schema/index.js';

export class ConfigSnapshotStore {
  constructor(private currentConfig: Config) {}

  getConfig(): Config {
    return this.currentConfig;
  }

  setConfig(config: Config): void {
    this.currentConfig = config;
  }
}
