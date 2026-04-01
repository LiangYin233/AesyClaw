/**
 * 插件管理服务
 * 
 * 对外提供插件管理功能：
 * - 列出所有插件
 * - 启用/禁用插件
 * - 更新插件配置
 */

import type { Config } from '../../../types.js';
import type { PluginCoordinator } from './coordinator.js';
import type { PluginMetadata, PluginSettings, PluginConfigs } from './core/types.js';

/** 资源未找到错误 */
export class ResourceNotFoundError extends Error {
  constructor(resource: string, name: string) {
    super(`${resource} 未找到: ${name}`);
    this.name = 'ResourceNotFoundError';
  }
}

/** 切换插件请求 */
export interface ToggleRequest {
  enabled: boolean;
}

/** 更新配置请求 */
export interface UpdateConfigRequest {
  enabled?: boolean;
  settings: PluginSettings;
}

/** 切换响应 */
export interface ToggleResponse {
  success: true;
}

/** 更新配置响应 */
export interface UpdateConfigResponse {
  success: true;
}

/** 列出插件响应 */
export interface ListPluginsResponse {
  plugins: PluginMetadata[];
}

export class PluginAdminService {
  constructor(
    private readonly coordinator: PluginCoordinator,
    private readonly updateConfig?: (mutator: (config: Config) => Config | void) => Promise<Config>
  ) {}

  /**
   * 列出所有插件
   */
  async listPlugins(): Promise<ListPluginsResponse> {
    return {
      plugins: await this.coordinator.list()
    };
  }

  /**
   * 切换插件启用状态
   * 
   * @throws ResourceNotFoundError 如果插件不存在
   */
  async togglePlugin(name: string, request: ToggleRequest): Promise<ToggleResponse> {
    const plugin = await this.coordinator.get(name);
    
    if (!plugin) {
      throw new ResourceNotFoundError('Plugin', name);
    }

    // 更新协调器内部配置状态
    const currentConfigs = this.coordinator.getConfigs();
    const newConfigs: PluginConfigs = {
      ...currentConfigs,
      [name]: {
        enabled: request.enabled,
        options: currentConfigs[name]?.options ?? plugin.settings
      }
    };
    this.coordinator.setConfigs(newConfigs);

    // 启用或禁用插件
    if (request.enabled) {
      await this.coordinator.enable(name, plugin.settings);
    } else {
      await this.coordinator.disable(name);
    }

    // 持久化配置到文件
    if (this.updateConfig) {
      await this.updateConfig((draft) => {
        if (!draft.plugins) {
          draft.plugins = {};
        }
        draft.plugins[name] = {
          enabled: request.enabled,
          options: currentConfigs[name]?.options ?? plugin.settings
        };
      });
    }

    return { success: true };
  }

  /**
   * 更新插件配置
   * 
   * 配置逻辑：
   * - 配置缺失 → 补全（使用默认值或请求中的值）
   * - 配置存在 → 忽略（不更新）
   * 
   * @throws ResourceNotFoundError 如果插件不存在
   */
  async updatePluginConfig(name: string, request: UpdateConfigRequest): Promise<UpdateConfigResponse> {
    const plugin = await this.coordinator.get(name);
    
    if (!plugin) {
      throw new ResourceNotFoundError('Plugin', name);
    }

    const currentConfigs = this.coordinator.getConfigs();
    const existingConfig = currentConfigs[name];

    // 配置已存在，忽略更新
    if (existingConfig) {
      return { success: true };
    }

    // 配置缺失，补全默认值
    const newConfig: PluginConfigs = {
      ...currentConfigs,
      [name]: {
        enabled: request.enabled ?? plugin.defaultEnabled ?? false,
        options: request.settings
      }
    };
    this.coordinator.setConfigs(newConfig);

    // 持久化配置到文件
    if (this.updateConfig) {
      await this.updateConfig((draft) => {
        if (!draft.plugins) {
          draft.plugins = {};
        }
        draft.plugins[name] = {
          enabled: request.enabled ?? plugin.defaultEnabled ?? false,
          options: request.settings
        };
      });
    }

    return { success: true };
  }
}
