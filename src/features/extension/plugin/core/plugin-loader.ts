/**
 * 插件加载器
 * 
 * 负责：
 * 1. 扫描插件目录，发现插件
 * 2. 动态导入插件模块
 * 3. 启动/停止插件实例
 */

import { readdir, stat, readFile } from 'fs/promises';
import { join } from 'path';
import { pathToFileURL } from 'url';
import type {
  PluginManifest,
  FoundPlugin,
  RunningPlugin,
  PluginSettings,
  PluginAPI,
  CleanupFunction,
  PluginHookRegistry,
  SendOptions
} from './types.js';
import type { Config, OutboundMessage } from '../../../../types.js';
import type { Tool } from '../../../../platform/tools/ToolRegistry.js';
import type { Logger } from '../../../../platform/observability/index.js';

/** 加载器依赖 */
export interface LoaderDependencies {
  workspace: string;
  tempDir: string;
  pluginsDir: string;
  getConfig: () => Config;
  logger: Logger;
  sendMessage: (message: OutboundMessage, options?: SendOptions) => Promise<void>;
}

/**
 * 扫描插件目录，发现所有插件
 * 
 * 扫描规则：
 * 1. 遍历 pluginsDir 目录
 * 2. 查找以 "plugin_" 开头的子目录
 * 3. 读取 package.json 的 main 字段，或默认使用 main.ts
 * 4. 动态导入模块，验证是否为有效插件
 */
export async function scanPlugins(pluginsDir: string, logger: Logger): Promise<FoundPlugin[]> {
  const found: FoundPlugin[] = [];
  
  try {
    const entries = await readdir(pluginsDir, { withFileTypes: true });
    
    // 筛选以 plugin_ 开头的目录，并按字母排序
    const pluginDirs = entries
      .filter(entry => entry.isDirectory() && entry.name.startsWith('plugin_'))
      .map(entry => entry.name)
      .sort((a, b) => a.localeCompare(b));
    
    for (let order = 0; order < pluginDirs.length; order++) {
      const name = pluginDirs[order];
      const pluginDir = join(pluginsDir, name);
      
      // 确定入口文件
      let entryPath: string | undefined;
      
      // 优先读取 package.json
      try {
        const packagePath = join(pluginDir, 'package.json');
        const packageStat = await stat(packagePath);
        if (packageStat.isFile()) {
          const packageContent = await readFile(packagePath, 'utf-8');
          const packageJson = JSON.parse(packageContent) as { main?: string };
          if (packageJson.main) {
            entryPath = join(pluginDir, packageJson.main);
          }
        }
      } catch {
        // package.json 不存在或无效，忽略
      }
      
      // 回退到 main.ts
      if (!entryPath) {
        entryPath = join(pluginDir, 'main.ts');
      }
      
      // 验证入口文件存在
      try {
        const entryStat = await stat(entryPath);
        if (!entryStat.isFile()) continue;
      } catch {
        logger.warn(`插件入口文件不存在: ${name}`, { plugin: name, entryPath });
        continue;
      }
      
      // 动态导入并验证
      try {
        const module = await importPluginModule<Record<string, unknown>>(entryPath);
        const manifest = (module.default ?? module) as unknown;
        
        if (!isValidManifest(manifest)) {
          logger.warn(`无效的插件清单: ${name}`, { plugin: name });
          continue;
        }
        
        found.push({
          name,
          sourcePath: entryPath,
          order,
          manifest
        });
        
        logger.debug(`发现插件: ${name}`, { plugin: name, version: manifest.version });
      } catch (error) {
        logger.warn(`加载插件失败: ${name}`, { plugin: name, error });
      }
    }
  } catch (error) {
    logger.error(`扫描插件目录失败`, { pluginsDir, error });
  }
  
  logger.info(`插件扫描完成`, { count: found.length, plugins: found.map(p => p.name) });
  return found;
}

/**
 * 使用 tsx 动态导入 TypeScript 模块
 */
async function importPluginModule<T = unknown>(modulePath: string): Promise<T> {
  const { tsImport } = await import('tsx/esm/api');
  return tsImport(pathToFileURL(modulePath).href, { parentURL: import.meta.url }) as Promise<T>;
}

/**
 * 验证是否为有效的插件清单
 */
function isValidManifest(value: unknown): value is PluginManifest {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'name' in value &&
    typeof (value as Record<string, unknown>).name === 'string' &&
    'version' in value &&
    typeof (value as Record<string, unknown>).version === 'string' &&
    'setup' in value &&
    typeof (value as Record<string, unknown>).setup === 'function'
  );
}

/**
 * 创建空的钩子注册表
 */
function createEmptyHooks(): PluginHookRegistry {
  return {
    incomingMessage: [],
    outgoingMessage: [],
    beforeToolCall: [],
    afterToolCall: [],
    agentStart: [],
    agentComplete: [],
    error: []
  };
}

/**
 * 启动插件
 * 
 * 流程：
 * 1. 构建 PluginAPI
 * 2. 调用 manifest.setup(api)
 * 3. 收集注册的工具、命令、钩子
 * 4. 返回 RunningPlugin
 */
export async function startPlugin(
  found: FoundPlugin,
  settings: PluginSettings,
  deps: LoaderDependencies
): Promise<RunningPlugin> {
  const { manifest } = found;
  const pluginLogger = deps.logger.child(manifest.name);
  
  // 收集注册的内容
  const tools: Tool[] = [];
  const commands: RunningPlugin['commands'] = [];
  const hooks = createEmptyHooks();
  
  // 构建 API
  const api: PluginAPI = {
    config: Object.freeze(structuredClone(deps.getConfig())),
    settings: Object.freeze(structuredClone(settings)) as PluginSettings,
    workspace: deps.workspace,
    tempDir: deps.tempDir,
    logger: pluginLogger,
    
    tools: {
      register(tool) {
        tools.push({ ...tool, source: 'plugin' as const });
      }
    },
    
    commands: {
      register(command) {
        commands.push(command);
      }
    },
    
    hooks: {
      incomingMessage: {
        transform: (handler) => hooks.incomingMessage.push(handler)
      },
      outgoingMessage: {
        transform: (handler) => hooks.outgoingMessage.push(handler)
      },
      beforeToolCall: {
        transform: (handler) => hooks.beforeToolCall.push(handler)
      },
      afterToolCall: {
        transform: (handler) => hooks.afterToolCall.push(handler)
      },
      agentStart: {
        observe: (handler) => hooks.agentStart.push(handler)
      },
      agentComplete: {
        observe: (handler) => hooks.agentComplete.push(handler)
      },
      error: {
        observe: (handler) => hooks.error.push(handler)
      }
    },
    
    send: deps.sendMessage
  };
  
  // 执行初始化
  let cleanup: CleanupFunction | undefined;
  try {
    const result = await manifest.setup(api);
    if (typeof result === 'function') {
      cleanup = result;
    }
  } catch (error) {
    pluginLogger.error(`插件初始化失败`, { error });
    throw error;
  }
  
  pluginLogger.info(`插件启动成功`, { tools: tools.length, commands: commands.length });
  
  return {
    name: manifest.name,
    order: found.order,
    manifest,
    settings: Object.freeze(settings) as PluginSettings,
    tools,
    commands,
    hooks,
    cleanup
  };
}

/**
 * 停止插件
 */
export async function stopPlugin(plugin: RunningPlugin, logger: Logger): Promise<void> {
  try {
    if (plugin.cleanup) {
      await plugin.cleanup();
    }
    logger.info(`插件已停止`, { plugin: plugin.name });
  } catch (error) {
    logger.warn(`插件清理失败`, { plugin: plugin.name, error });
    // 忽略清理错误
  }
}
