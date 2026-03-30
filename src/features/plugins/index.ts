/**
 * Plugins 模块
 * 
 * AesyClaw 的插件系统，支持：
 * - 动态插件发现与加载
 * - 7个生命周期钩子
 * - 命令系统
 * - 工具注册
 * 
 * @example
 * ```typescript
 * import { setupPlugins, createConfigChangeHandler, PluginCoordinator } from './plugins/index.js';
 * 
 * // 设置插件系统
 * const system = await setupPlugins({
 *   workspace: process.cwd(),
 *   tempDir: './temp',
 *   pluginsDir: './plugins',
 *   getConfig: () => config,
 *   toolRegistry,
 *   outboundPublisher: async (msg) => sendMessage(msg),
 *   updateConfig: async (mutator) => updateConfig(mutator),
 *   logger
 * });
 * 
 * // 后台加载插件
 * system.startLoading();
 * 
 * // 使用协调器执行钩子
 * const processed = await system.coordinator.transformIncomingMessage(message);
 * ```
 */

// ========== 核心类 ==========

export { PluginCoordinator, type CoordinatorDependencies } from './coordinator.js';

export { PluginAdminService, ResourceNotFoundError } from './service.js';

// ========== 运行时 ==========

export {
  setupPlugins,
  createConfigChangeHandler,
  type RuntimeDependencies,
  type PluginSystem,
  type ConfigChangeHandler
} from './runtime.js';

// ========== 类型 ==========

export type {
  // 插件定义
  PluginManifest,
  PluginAPI,
  PluginSettings,
  CleanupFunction,
  
  // 命令系统
  PluginCommand,
  CommandPattern,
  CommandResult,
  
  // 钩子
  PluginHookRegistry,
  TransformHandler,
  ObserverHandler,
  ToolCallInfo,
  AgentContext,
  
  // 内部类型
  FoundPlugin,
  RunningPlugin,
  PluginConfigEntry,
  PluginConfigs,
  PluginMetadata,
  SendOptions,
  
  // 注册API
  ToolRegistryAPI,
  CommandRegistryAPI,
  HookRegistryAPI
} from './core/types.js';

// ========== 服务请求/响应类型 ==========

export type {
  ToggleRequest,
  ToggleResponse,
  UpdateConfigRequest,
  UpdateConfigResponse,
  ListPluginsResponse
} from './service.js';

// 导出 DTO 解析函数
export { parseTogglePlugin, parsePluginConfigUpdate } from './contracts/plugins.dto.js';
