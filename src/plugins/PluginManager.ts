import type { InboundMessage, OutboundMessage, ToolDefinition, Config } from '../types.js';
import type { EventBus } from '../bus/EventBus.js';
import type { AgentLoop } from '../agent/AgentLoop.js';
import type { ToolRegistry, Tool } from '../tools/ToolRegistry.js';
import { logger } from '../logger/index.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

export interface Middleware {
  (msg: InboundMessage, next: () => Promise<void>): Promise<void>;
}

export interface Plugin {
  name: string;
  version: string;
  description?: string;
  author?: string;
  options?: Record<string, any>;

  onLoad?(options?: Record<string, any>): Promise<void>;
  onUnload?(): Promise<void>;

  onMessage?(msg: InboundMessage): Promise<InboundMessage | null>;
  onResponse?(msg: OutboundMessage): Promise<OutboundMessage | null>;

  onStart?(): Promise<void>;
  onStop?(): Promise<void>;

  tools?: Tool[];
  middleware?: Middleware[];
}

export interface PluginContext {
  config: Config;
  eventBus: EventBus;
  agent: AgentLoop | null;
  workspace: string;
  registerTool(tool: Tool): void;
  getToolRegistry(): ToolRegistry;
  logger: typeof logger;
}

export interface PluginLoaderConfig {
  name: string;
  enabled: boolean;
  options?: Record<string, any>;
}

export class PluginManager {
  private plugins: Map<string, Plugin> = new Map();
  public context: PluginContext;
  private toolRegistry: ToolRegistry;
  private log = logger.child({ prefix: 'PluginManager' });

  constructor(context: PluginContext, toolRegistry: ToolRegistry) {
    this.context = { ...context, logger };
    this.toolRegistry = toolRegistry;
    
    this.context.eventBus.on('outbound', async (msg: OutboundMessage) => {
      await this.handleOutbound(msg);
    });
  }

  private async handleOutbound(msg: OutboundMessage): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (plugin.onResponse) {
        try {
          const result = await plugin.onResponse(msg);
          if (result) {
            msg = result;
          }
        } catch (error) {
          this.log.error(`Plugin ${plugin.name} onResponse error:`, error);
        }
      }
    }
  }

  async applyOnResponse(msg: OutboundMessage): Promise<OutboundMessage | null> {
    let result = msg;
    this.log.info(`applyOnResponse called with ${this.plugins.size} plugins, reasoning_content: ${!!msg.reasoning_content}, length: ${msg.reasoning_content?.length || 0}`);
    for (const plugin of this.plugins.values()) {
      this.log.info(`Processing plugin: ${plugin.name}, has onResponse: ${!!plugin.onResponse}`);
      if (plugin.onResponse) {
        try {
          const newResult = await plugin.onResponse(result);
          this.log.info(`Plugin ${plugin.name} returned, media: ${JSON.stringify(newResult?.media)}`);
          if (newResult) {
            result = newResult;
          }
        } catch (error) {
          this.log.error(`Plugin ${plugin.name} onResponse error:`, error);
        }
      }
    }
    return result;
  }

  async loadPlugin(plugin: Plugin): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      this.log.warn(`Plugin ${plugin.name} already loaded`);
      return;
    }

    this.log.info(`Loading plugin: ${plugin.name} v${plugin.version}, has onResponse: ${!!plugin.onResponse}`);
    
    if (plugin.onLoad) {
      const pluginContext = {
        options: plugin.options,
        logger: this.context.logger,
        workspace: this.context.workspace
      };
      await plugin.onLoad(pluginContext);
      this.log.debug(`Plugin ${plugin.name} onLoad completed with options:`, plugin.options);
    }

    if (plugin.tools) {
      for (const tool of plugin.tools) {
        this.toolRegistry.register(tool);
        this.log.debug(`Registered tool from ${plugin.name}: ${tool.name}`);
      }
    }

    if (plugin.onStart) {
      await plugin.onStart();
    }

    this.plugins.set(plugin.name, plugin);
    this.log.info(`Loaded plugin: ${plugin.name}, has onResponse: ${!!plugin.onResponse}`);
  }

  async unloadPlugin(name: string): Promise<void> {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      return;
    }

    if (plugin.onStop) {
      await plugin.onStop();
    }

    if (plugin.onUnload) {
      await plugin.onUnload();
    }

    if (plugin.tools) {
      for (const tool of plugin.tools) {
        this.toolRegistry.unregister(tool.name);
      }
    }

    this.plugins.delete(name);
    this.log.info(`Unloaded plugin: ${name}`);
  }

  getPlugin(name: string): Plugin | undefined {
    return this.plugins.get(name);
  }

  listPlugins(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  async loadFromConfig(config: Record<string, PluginLoaderConfig>): Promise<void> {
    for (const [name, pluginConfig] of Object.entries(config)) {
      if (!pluginConfig.enabled) {
        this.log.debug(`Plugin ${name} is disabled, skipping`);
        continue;
      }
      
      try {
        const plugin = await this.loadPluginModule(name, pluginConfig.options);
        if (plugin) {
          await this.loadPlugin(plugin);
        }
      } catch (error) {
        this.log.error(`Failed to load plugin ${name}:`, error);
      }
    }
  }

  private async loadPluginModule(name: string, options?: Record<string, any>): Promise<Plugin | null> {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const pluginPath = join(__dirname, '..', '..', 'plugins', name, 'main.js');
    
    try {
      this.log.debug(`Loading plugin from: ${pluginPath}`);
      const module = await import(`file://${pluginPath}`);
      const plugin = module.default || module;
      if (options) {
        plugin.options = options;
      }
      return plugin;
    } catch (error) {
      this.log.warn(`Plugin module not found: ${name}`, error);
      return null;
    }
  }
}
