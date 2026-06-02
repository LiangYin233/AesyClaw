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

export class ConfigService {
  /**
   * 获取配置 Schema
   */
  async getConfigSchema(): Promise<ConfigSchema> {
    return await apiClient.request<ConfigSchema>('get_config_schema');
  }

  /**
   * 获取当前配置
   */
  async getConfig(): Promise<Config> {
    return await apiClient.request<Config>('get_config');
  }

  /**
   * 更新配置
   */
  async updateConfig(config: Config): Promise<void> {
    await apiClient.request('update_config', config);
  }

  /**
   * 重载配置
   */
  async reloadConfig(): Promise<void> {
    await apiClient.request('reload_config');
  }

  /**
   * 获取插件列表
   */
  async getPlugins(): Promise<Array<{ name: string; version: string; enabled: boolean }>> {
    return await apiClient.request('get_plugins');
  }

  /**
   * 获取通道列表
   */
  async getChannels(): Promise<Array<{ name: string; version: string; enabled: boolean }>> {
    return await apiClient.request('get_channels');
  }

  /**
   * 监听配置更新
   */
  onConfigUpdate(handler: (config: Config) => void): void {
    apiClient.on('config_update', (data: unknown) => handler(data as Config));
  }

  /**
   * 移除配置更新监听器
   */
  offConfigUpdate(handler: (config: Config) => void): void {
    apiClient.off('config_update', (data: unknown) => handler(data as Config));
  }
}

export const configService = new ConfigService();
