import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../../platform/observability/logger.js';
import { ToolRegistry } from '../../platform/tools/registry.js';
import {
  IPlugin,
  PluginContext,
  PluginInfo,
  HookName,
  PluginHooks,
  HookPayloadMessageReceive,
  HookPayloadBeforeLLMRequest,
  HookPayloadToolCall,
  HookPayloadAfterToolCall,
  HookPayloadMessageSend,
} from './types.js';
import type { PluginConfig } from '../config/schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class PluginManager {
  private static instance: PluginManager;

  private toolRegistry: ToolRegistry;
  private loadedPlugins: Map<string, IPlugin> = new Map();
  private pluginInfos: Map<string, PluginInfo> = new Map();
  private initialized: boolean = false;
  private pluginsDir: string;

  private constructor(toolRegistry: ToolRegistry) {
    this.toolRegistry = toolRegistry;
    this.pluginsDir = path.resolve(__dirname, '../../../plugins');
  }

  static getInstance(toolRegistry: ToolRegistry): PluginManager {
    if (!PluginManager.instance) {
      PluginManager.instance = new PluginManager(toolRegistry);
    }
    return PluginManager.instance;
  }

  static resetInstance(): void {
    if (PluginManager.instance) {
      PluginManager.instance.shutdown();
      PluginManager.instance = undefined as any;
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn({}, 'PluginManager already initialized');
      return;
    }

    logger.info({}, '🔌 Initializing PluginManager...');
    this.initialized = true;
  }

  async scanAndLoad(enabledPlugins: PluginConfig[]): Promise<void> {
    logger.info({ pluginsDir: this.pluginsDir }, 'Scanning plugins directory');

    if (!fs.existsSync(this.pluginsDir)) {
      logger.warn({ pluginsDir: this.pluginsDir }, 'Plugins directory does not exist, creating...');
      fs.mkdirSync(this.pluginsDir, { recursive: true });
      return;
    }

    const entries = fs.readdirSync(this.pluginsDir, { withFileTypes: true });
    const pluginDirs = entries.filter(
      entry => entry.isDirectory() && entry.name.startsWith('plugin_')
    );

    logger.info({ found: pluginDirs.length }, 'Found plugin directories');

    for (const dir of pluginDirs) {
      const pluginDir = path.join(this.pluginsDir, dir.name);

      try {
        const packageJsonPath = path.join(pluginDir, 'package.json');
        if (!fs.existsSync(packageJsonPath)) {
          logger.warn({ pluginDir }, 'Plugin missing package.json, skipping');
          continue;
        }

        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        const pluginName = packageJson.name || dir.name;

        const config = enabledPlugins.find(p => {
          const configName = p.name.replace('@aesyclaw/plugin-', '').replace('plugin-', '');
          return configName === pluginName || configName === dir.name;
        });

        if (config && !config.enabled) {
          logger.info({ pluginName }, 'Plugin disabled in config, skipping');
          continue;
        }

        const mainFile = packageJson.main || 'dist/index.js';
        const pluginPath = path.join(pluginDir, mainFile);

        if (!fs.existsSync(pluginPath)) {
          logger.warn({ pluginPath }, 'Plugin main file not found, trying source path');
          const srcPath = path.join(pluginDir, 'src/index.ts');
          if (fs.existsSync(srcPath)) {
            await this.loadPluginFromSource(pluginName, srcPath, config?.options || {});
          } else {
            logger.warn({ pluginName }, 'Plugin entry point not found');
          }
        } else {
          await this.loadPluginFromDist(pluginName, pluginPath, config?.options || {});
        }
      } catch (error) {
        logger.error({ pluginDir, error }, 'Failed to load plugin from directory');
      }
    }

    logger.info(
      { loaded: this.loadedPlugins.size },
      'Plugin scanning and loading completed'
    );
  }

  private async loadPluginFromDist(
    pluginName: string,
    pluginPath: string,
    options: Record<string, unknown>
  ): Promise<void> {
    try {
      const pluginModule = await import(pluginPath);
      const plugin = pluginModule.default || pluginModule;

      if (!plugin || !plugin.name) {
        logger.warn({ pluginPath }, 'Invalid plugin module, missing name');
        return;
      }

      await this.initializePlugin(plugin, options);
    } catch (error) {
      logger.error({ pluginPath, error }, 'Failed to dynamically import plugin');
    }
  }

  private async loadPluginFromSource(
    pluginName: string,
    sourcePath: string,
    options: Record<string, unknown>
  ): Promise<void> {
    try {
      const tsxModule = await import(sourcePath);
      const plugin = tsxModule.default || tsxModule;

      if (!plugin || !plugin.name) {
        logger.warn({ sourcePath }, 'Invalid plugin module, missing name');
        return;
      }

      await this.initializePlugin(plugin, options);
    } catch (error) {
      logger.error({ sourcePath, error }, 'Failed to load plugin from source');
    }
  }

  private async initializePlugin(
    plugin: IPlugin,
    options: Record<string, unknown>
  ): Promise<void> {
    if (this.loadedPlugins.has(plugin.name)) {
      logger.warn({ pluginName: plugin.name }, 'Plugin already loaded, skipping');
      return;
    }

    logger.info(
      { pluginName: plugin.name, version: plugin.version },
      'Loading plugin'
    );

    const context: PluginContext = {
      logger: {
        info: (msg: string, data?: Record<string, unknown>) =>
          logger.info({ plugin: plugin.name, ...data }, `[${plugin.name}] ${msg}`),
        warn: (msg: string, data?: Record<string, unknown>) =>
          logger.warn({ plugin: plugin.name, ...data }, `[${plugin.name}] ${msg}`),
        error: (msg: string, data?: Record<string, unknown>) =>
          logger.error({ plugin: plugin.name, ...data }, `[${plugin.name}] ${msg}`),
        debug: (msg: string, data?: Record<string, unknown>) =>
          logger.debug({ plugin: plugin.name, ...data }, `[${plugin.name}] ${msg}`),
      },
      config: options,
      toolRegistry: this.toolRegistry,
    };

    try {
      if (plugin.init) {
        await plugin.init(context);
      }

      this.loadedPlugins.set(plugin.name, plugin);
      this.pluginInfos.set(plugin.name, {
        name: plugin.name,
        description: plugin.description,
        version: plugin.version,
        loaded: true,
        hooks: this.getPluginHookNames(plugin),
      });

      logger.info({ pluginName: plugin.name }, '✅ Plugin loaded successfully');
    } catch (error) {
      logger.error({ pluginName: plugin.name, error }, '❌ Plugin initialization failed');
    }
  }

  private getPluginHookNames(plugin: IPlugin): string[] {
    const hooks: string[] = [];
    if (plugin.hooks) {
      if (plugin.hooks.onMessageReceive) hooks.push('onMessageReceive');
      if (plugin.hooks.beforeLLMRequest) hooks.push('beforeLLMRequest');
      if (plugin.hooks.beforeToolCall) hooks.push('beforeToolCall');
      if (plugin.hooks.afterToolCall) hooks.push('afterToolCall');
      if (plugin.hooks.onMessageSend) hooks.push('onMessageSend');
    }
    return hooks;
  }

  async dispatchHook<K extends HookName>(
    hookName: K,
    payload: Parameters<PluginHooks[K]>[0] extends undefined ? undefined : Parameters<PluginHooks[K]>[0]
  ): Promise<ReturnType<NonNullable<PluginHooks[K]>>> {
    let result: any = payload;

    for (const [, plugin] of this.loadedPlugins) {
      if (!plugin.hooks) continue;

      const hook = plugin.hooks[hookName];
      if (!hook) continue;

      try {
        logger.debug(
          { pluginName: plugin.name, hookName },
          'Dispatching hook'
        );

        const hookResult = await hook(result);

        if (hookResult !== undefined && hookResult !== null) {
          result = hookResult;
        }
      } catch (error) {
        logger.error(
          { pluginName: plugin.name, hookName, error },
          'Hook execution failed'
        );
      }
    }

    return result;
  }

  async dispatchMessageReceive(
    payload: HookPayloadMessageReceive
  ): Promise<HookPayloadMessageReceive['message'] | null> {
    return this.dispatchHook('onMessageReceive', payload);
  }

  async dispatchBeforeLLMRequest(
    payload: HookPayloadBeforeLLMRequest
  ): Promise<void> {
    await this.dispatchHook('beforeLLMRequest', payload);
  }

  async dispatchBeforeToolCall(
    toolCall: HookPayloadToolCall
  ): Promise<{ success: boolean; content: string; error?: string } | null> {
    return this.dispatchHook('beforeToolCall', toolCall);
  }

  async dispatchAfterToolCall(
    payload: HookPayloadAfterToolCall
  ): Promise<HookPayloadAfterToolCall['result']> {
    return this.dispatchHook('afterToolCall', payload);
  }

  async dispatchMessageSend(
    payload: HookPayloadMessageSend
  ): Promise<HookPayloadMessageSend['message'] | null> {
    return this.dispatchHook('onMessageSend', payload);
  }

  async unloadPlugin(pluginName: string): Promise<void> {
    const plugin = this.loadedPlugins.get(pluginName);
    if (!plugin) {
      logger.warn({ pluginName }, 'Plugin not loaded, skipping unload');
      return;
    }

    try {
      if (plugin.destroy) {
        await plugin.destroy();
      }

      this.loadedPlugins.delete(pluginName);
      this.pluginInfos.delete(pluginName);

      logger.info({ pluginName }, '✅ Plugin unloaded successfully');
    } catch (error) {
      logger.error({ pluginName, error }, '❌ Plugin unload failed');
    }
  }

  getLoadedPlugins(): PluginInfo[] {
    return Array.from(this.pluginInfos.values());
  }

  getPluginInfo(pluginName: string): PluginInfo | undefined {
    return this.pluginInfos.get(pluginName);
  }

  isPluginLoaded(pluginName: string): boolean {
    return this.loadedPlugins.has(pluginName);
  }

  shutdown(): void {
    logger.info({}, 'Shutting down PluginManager');

    for (const [name, plugin] of this.loadedPlugins.entries()) {
      if (plugin.destroy) {
        plugin.destroy().catch((err) => {
          logger.error({ pluginName: name, error: err }, 'Plugin destroy failed');
        });
      }
    }

    this.loadedPlugins.clear();
    this.pluginInfos.clear();
    this.initialized = false;
  }

  getPluginCount(): number {
    return this.loadedPlugins.size;
  }

  getPluginsDir(): string {
    return this.pluginsDir;
  }

  setPluginsDir(dir: string): void {
    this.pluginsDir = dir;
    logger.info({ pluginsDir: this.pluginsDir }, 'Plugins directory updated');
  }
}

export const pluginManager = PluginManager.getInstance(
  ToolRegistry.getInstance()
);
