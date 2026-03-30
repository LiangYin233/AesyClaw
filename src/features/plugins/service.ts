/**
 * 插件管理服务
 * 
 * 对外提供插件管理功能：
 * - 列出所有插件
 * - 启用/禁用插件
 * - 更新插件配置
 */

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
  constructor(private readonly coordinator: PluginCoordinator) {}

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

    if (request.enabled) {
      await this.coordinator.enable(name, plugin.settings);
    } else {
      await this.coordinator.disable(name);
    }

    return { success: true };
  }

  /**
   * 更新插件配置
   * 
   * @throws ResourceNotFoundError 如果插件不存在
   */
  async updatePluginConfig(name: string, request: UpdateConfigRequest): Promise<UpdateConfigResponse> {
    const plugin = await this.coordinator.get(name);
    
    if (!plugin) {
      throw new ResourceNotFoundError('Plugin', name);
    }

    await this.coordinator.reload(name, request.settings);

    return { success: true };
  }

  /**
   * 应用默认配置
   * 
   * 为尚未配置的插件添加默认配置
   * 
   * @returns 是否需要更新配置
   */
  async applyDefaultConfigs(): Promise<{ configs: PluginConfigs; changed: boolean }> {
    const discovered = await this.coordinator.list();
    const currentConfigs = this.coordinator.getConfigs();
    let changed = false;

    const newConfigs: PluginConfigs = { ...currentConfigs };

    for (const plugin of discovered) {
      if (newConfigs[plugin.name]) {
        // 已有配置，跳过
        continue;
      }

      // 添加默认配置
      changed = true;
      newConfigs[plugin.name] = {
        isEnabled: plugin.defaultEnabled ?? false,
        settings: plugin.defaultSettings ? { ...plugin.defaultSettings } : undefined
      };
    }

    if (changed) {
      this.coordinator.setConfigs(newConfigs);
    }

    return { configs: newConfigs, changed };
  }
}
