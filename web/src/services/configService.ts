/**
 * 配置相关 API 服务
 */

import { apiClient } from './api';

export interface ConfigSchema {
  type: string;
  properties: Record<string, unknown>;
  required?: string[];
}

export interface Config {
  providers?: Record<string, unknown>;
  mcp?: Array<Record<string, unknown>>;
  channels?: Record<string, unknown>;
  plugins?: Record<string, unknown>;
  [key: string]: unknown;
}

export const configService = {
  getConfigSchema(): Promise<ConfigSchema> {
    return apiClient.request<ConfigSchema>('get_config_schema');
  },

  getConfig(): Promise<Config> {
    return apiClient.request<Config>('get_config');
  },

  async updateConfig(config: Config): Promise<void> {
    await apiClient.request('update_config', config);
  },

  async reloadConfig(): Promise<void> {
    await apiClient.request('reload_config');
  },

  getPlugins(): Promise<Array<{ name: string; version: string; enabled: boolean }>> {
    return apiClient.request('get_plugins');
  },

  getChannels(): Promise<Array<{ name: string; version: string; enabled: boolean }>> {
    return apiClient.request('get_channels');
  },

  onConfigUpdate(handler: (config: Config) => void): void {
    apiClient.on('config_update', (data: unknown) => handler(data as Config));
  },

  offConfigUpdate(handler: (config: Config) => void): void {
    apiClient.off('config_update', (data: unknown) => handler(data as Config));
  },
};
