/**
 * 插件系统运行时
 * 
 * 负责：
 * 1. 创建和初始化插件协调器
 * 2. 后台加载插件
 * 3. 配置重载处理
 */

import type { OutboundMessage, Config } from '../../types.js';
import type { ToolRegistry } from '../../platform/tools/ToolRegistry.js';
import type { Logger } from '../../platform/observability/index.js';
import type { PluginConfigs } from './core/types.js';
import { PluginCoordinator, type CoordinatorDependencies } from './coordinator.js';
import { PluginAdminService } from './service.js';

/** 运行时依赖 */
export interface RuntimeDependencies {
  workspace: string;
  tempDir: string;
  pluginsDir: string;
  getConfig: () => Config;
  toolRegistry: ToolRegistry;
  outboundPublisher: (message: OutboundMessage) => Promise<void>;
  updateConfig: (mutator: (config: Config) => Config | void) => Promise<Config>;
  logger: Logger;
}

/** 插件系统 */
export interface PluginSystem {
  /** 插件协调器（核心） */
  coordinator: PluginCoordinator;

  /** 插件管理服务 */
  adminService: PluginAdminService;

  /** 开始后台加载插件 */
  startLoading(): void;

  /** 检查后台加载是否完成 */
  isReady(): boolean;
}

/** 配置重载处理器 */
export interface ConfigChangeHandler {
  /** 应用新配置 */
  applyConfig(config: Config): Promise<void>;
}

/**
 * 转换插件配置格式
 * 兼容旧格式 {enabled, options} 和新格式 {isEnabled, settings}
 */
function convertPluginConfig(entry: unknown): { isEnabled: boolean; settings?: Record<string, unknown> } {
  if (!entry || typeof entry !== 'object') {
    return { isEnabled: false };
  }
  
  const e = entry as Record<string, unknown>;
  const isEnabled = (e.isEnabled as boolean | undefined) ?? (e.enabled as boolean | undefined) ?? false;
  const settings = (e.settings ?? e.options) as Record<string, unknown> | undefined;
  
  return {
    isEnabled,
    settings: settings ? { ...settings } : undefined
  };
}

/**
 * 设置插件系统
 * 
 * 创建但不立即加载插件，调用 startLoading() 后会在后台异步加载
 */
export async function setupPlugins(deps: RuntimeDependencies): Promise<PluginSystem> {
  // 构建协调器依赖
  const coordinatorDeps: CoordinatorDependencies = {
    workspace: deps.workspace,
    tempDir: deps.tempDir,
    pluginsDir: deps.pluginsDir,
    getConfig: deps.getConfig,
    toolRegistry: deps.toolRegistry,
    outboundPublisher: deps.outboundPublisher,
    logger: deps.logger
  };

  // 创建协调器
  const coordinator = new PluginCoordinator(coordinatorDeps);
  
  // 创建管理服务
  const adminService = new PluginAdminService(coordinator, deps.updateConfig);

  let started = false;
  let completed = false;

  /**
   * 后台加载插件
   */
  function startLoading(): void {
    if (started) {
      return;
    }
    started = true;

    void (async () => {
      try {
        // 1. 应用默认配置
        const { configs: defaultConfigs, changed } = await adminService.applyDefaultConfigs();

        if (changed) {
          // 持久化默认配置
          await deps.updateConfig((draft) => {
            draft.plugins = defaultConfigs as Record<string, { enabled?: boolean; options?: Record<string, unknown> }>;
          });
        }

        // 2. 加载当前配置
        const currentConfig = deps.getConfig();
        const pluginConfigs: PluginConfigs = {};
        
        for (const [name, entry] of Object.entries(currentConfig.plugins ?? {})) {
          pluginConfigs[name] = convertPluginConfig(entry);
        }

        if (Object.keys(pluginConfigs).length > 0) {
          await coordinator.load(pluginConfigs);
        }

        deps.logger.info(`插件系统初始化完成`, { 
          enabled: coordinator.list().then(list => list.filter(p => p.isEnabled).length)
        });
      } catch (error) {
        deps.logger.error(`插件系统初始化失败`, { error });
      } finally {
        completed = true;
      }
    })();
  }

  return {
    coordinator,
    adminService,
    startLoading,
    isReady: () => completed
  };
}

/**
 * 创建配置重载处理器
 * 
 * 当配置文件变更时，调用此处理器重新加载插件配置
 */
export function createConfigChangeHandler(system: PluginSystem): ConfigChangeHandler {
  return {
    async applyConfig(config: Config): Promise<void> {
      const pluginConfigs: PluginConfigs = {};
      
      for (const [name, entry] of Object.entries(config.plugins ?? {})) {
        pluginConfigs[name] = convertPluginConfig(entry);
      }

      await system.coordinator.load(pluginConfigs);
    }
  };
}
