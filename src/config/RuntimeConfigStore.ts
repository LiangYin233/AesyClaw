import type { Config } from './schema.js';

export class RuntimeConfigStore {
  constructor(private currentConfig: Config) {}

  get(): Config {
    return this.currentConfig;
  }

  set(config: Config): void {
    this.currentConfig = config;
  }
}
