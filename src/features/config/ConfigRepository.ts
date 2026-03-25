import type { Config } from '../../types.js';

export class ConfigRepository {
  constructor(
    private readonly getConfigValue: () => Config,
    private readonly updateConfigValue: (mutator: (config: Config) => void | Config | Promise<void | Config>) => Promise<Config>
  ) {}

  getConfig(): Config {
    return this.getConfigValue();
  }

  async updateConfig(
    mutator: (config: Config) => void | Config | Promise<void | Config>
  ): Promise<Config> {
    return this.updateConfigValue(mutator);
  }
}
