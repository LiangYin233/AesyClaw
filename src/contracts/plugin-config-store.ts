export interface PluginRuntimeConfig {
  name: string;
  enabled: boolean;
  options?: Record<string, unknown>;
}

export interface PluginConfigStore {
  registerPluginDefaults(name: string, defaults: Record<string, unknown>): void;
  updatePluginConfig(
    name: string,
    enabled: boolean,
    options?: Record<string, unknown>
  ): Promise<boolean>;
}
