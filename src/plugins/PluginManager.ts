import type { InboundMessage, OutboundMessage, Config, LLMMessage, LLMResponse, PluginErrorContext } from '../types.js';
import type { EventBus } from '../bus/EventBus.js';
import type { AgentLoop } from '../agent/AgentLoop.js';
import type { ToolRegistry, Tool } from '../tools/ToolRegistry.js';
import { logger } from '../logger/index.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

export interface Middleware {
  (msg: InboundMessage, next: () => Promise<void>): Promise<void>;
}

export interface PluginCommand {
  name: string;
  description: string;
  pattern?: RegExp;
  handler: (msg: InboundMessage) => Promise<InboundMessage | null>;
}

export interface Plugin {
  name: string;
  version: string;
  description?: string;
  author?: string;
  options?: Record<string, any>;
  defaultConfig?: Record<string, any>;

  onLoad?(options?: Record<string, any>): Promise<void>;
  onUnload?(): Promise<void>;

  onMessage?(msg: InboundMessage): Promise<InboundMessage | null>;
  onResponse?(msg: OutboundMessage): Promise<OutboundMessage | null>;

  onAgentBefore?(msg: InboundMessage, messages: LLMMessage[]): Promise<void>;
  onAgentAfter?(msg: InboundMessage, response: LLMResponse): Promise<void>;
  onToolCall?(toolName: string, params: Record<string, any>, result: string): Promise<string | void>;
  onError?(error: Error, context: PluginErrorContext): Promise<void>;

  onStart?(): Promise<void>;
  onStop?(): Promise<void>;

  commands?: PluginCommand[];
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
  sendMessage(channel: string, chatId: string, content: string, messageType?: 'private' | 'group'): Promise<void>;
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
  private pluginConfigs: Record<string, { enabled: boolean; options?: Record<string, any> }> = {};

  constructor(context: PluginContext, toolRegistry: ToolRegistry) {
    this.context = {
      ...context,
      logger,
      sendMessage: async (channel: string, chatId: string, content: string, messageType?: 'private' | 'group') => {
        await context.eventBus.publishOutbound({
          channel,
          chatId,
          content,
          messageType: messageType || 'private'
        });
      }
    };
    this.toolRegistry = toolRegistry;
    
    this.context.eventBus.on('inbound', async (msg: InboundMessage) => {
      await this.handleInbound(msg);
    });
    
    this.context.eventBus.on('outbound', async (msg: OutboundMessage) => {
      await this.handleOutbound(msg);
    });
  }

  async applyOnCommand(msg: InboundMessage): Promise<InboundMessage | null> {
    const content = msg.content.trim();
    
    for (const plugin of this.plugins.values()) {
      if (!plugin.commands) continue;
      
      for (const cmd of plugin.commands) {
        if (cmd.pattern && cmd.pattern.test(content)) {
          this.log.debug(`Command ${cmd.name} matched by plugin ${plugin.name}`);
          try {
            const result = await cmd.handler(msg);
            return result;
          } catch (error) {
            this.log.error(`Plugin ${plugin.name} command ${cmd.name} error:`, error);
          }
        }
      }
    }
    
    return null;
  }

  private async handleInbound(msg: InboundMessage): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (plugin.onMessage) {
        try {
          const result = await plugin.onMessage(msg);
          if (result) {
            msg = result;
          }
        } catch (error) {
          this.log.error(`Plugin ${plugin.name} onMessage error:`, error);
        }
      }
    }
  }

  async applyOnMessage(msg: InboundMessage): Promise<InboundMessage | null> {
    let result = msg;
    for (const plugin of this.plugins.values()) {
      if (plugin.onMessage) {
        try {
          const newResult = await plugin.onMessage(result);
          if (newResult) {
            result = newResult;
          }
        } catch (error) {
          this.log.error(`Plugin ${plugin.name} onMessage error:`, error);
        }
      }
    }
    return result;
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

  async applyOnAgentBefore(msg: InboundMessage, messages: LLMMessage[]): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (plugin.onAgentBefore) {
        try {
          await plugin.onAgentBefore(msg, messages);
        } catch (error) {
          this.log.error(`Plugin ${plugin.name} onAgentBefore error:`, error);
        }
      }
    }
  }

  async applyOnAgentAfter(msg: InboundMessage, response: LLMResponse): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (plugin.onAgentAfter) {
        try {
          await plugin.onAgentAfter(msg, response);
        } catch (error) {
          this.log.error(`Plugin ${plugin.name} onAgentAfter error:`, error);
        }
      }
    }
  }

  async applyOnToolCall(toolName: string, params: Record<string, any>, result: string): Promise<string> {
    let finalResult = result;
    for (const plugin of this.plugins.values()) {
      if (plugin.onToolCall) {
        try {
          const modified = await plugin.onToolCall(toolName, params, finalResult);
          if (modified !== undefined) {
            finalResult = modified;
          }
        } catch (error) {
          this.log.error(`Plugin ${plugin.name} onToolCall error:`, error);
        }
      }
    }
    return finalResult;
  }

  async applyOnError(error: Error, context: PluginErrorContext): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (plugin.onError) {
        try {
          await plugin.onError(error, { ...context, plugin: plugin.name });
        } catch (err) {
          this.log.error(`Plugin ${plugin.name} onError handler error:`, err);
        }
      }
    }
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
      const pluginAny = plugin as any;
      for (const tool of plugin.tools) {
        const wrappedTool = {
          ...tool,
          execute: async (params: Record<string, any>, context?: any) => {
            return tool.execute.call(plugin, params, context);
          }
        };
        this.toolRegistry.register(wrappedTool);
        this.log.debug(`Registered tool from ${plugin.name}: ${tool.name}, has config: ${!!pluginAny.config}`);
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

  async loadFromConfig(config: Record<string, any>): Promise<void> {
    const pluginsDir = join(process.cwd(), 'plugins');
    
    try {
      const fs = await import('fs/promises');
      const entries = await fs.readdir(pluginsDir, { withFileTypes: true });
      
      for (const dir of entries) {
        if (!dir.isDirectory()) continue;
        
        const mainPath = join(pluginsDir, dir.name, 'main.js');
        
        let modulePlugin: Plugin | null = null;
        try {
          const module = await import(`file://${mainPath}`);
          modulePlugin = module.default || module;
        } catch (e) {
          continue;
        }
        
        if (!modulePlugin) continue;
        
        const pluginConfig = config[dir.name];
        let enabled = false;
        let options: Record<string, any> = {};
        
        if (pluginConfig?.enabled) {
          enabled = true;
          options = pluginConfig.options || {};
        } else if (modulePlugin.defaultConfig?.enabled === true) {
          enabled = true;
          options = modulePlugin.defaultConfig?.options || {};
        }
        
        if (enabled) {
          try {
            const plugin = await this.loadPluginModule(dir.name, options);
            if (plugin) {
              await this.loadPlugin(plugin);
            }
          } catch (error) {
            this.log.error(`Failed to load plugin ${dir.name}:`, error);
          }
        }
      }
    } catch (error) {
      this.log.error('Failed to scan plugins directory', error);
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

  async getAllPlugins(): Promise<Array<{
    name: string;
    version: string;
    description?: string;
    author?: string;
    enabled: boolean;
    options?: Record<string, any>;
    defaultConfig?: Record<string, any>;
    toolsCount: number;
  }>> {
    const pluginsDir = join(process.cwd(), 'plugins');
    const result: Array<{
      name: string;
      version: string;
      description?: string;
      author?: string;
      enabled: boolean;
      options?: Record<string, any>;
      defaultConfig?: Record<string, any>;
      toolsCount: number;
    }> = [];

    try {
      const fs = await import('fs/promises');
      const entries = await fs.readdir(pluginsDir, { withFileTypes: true });
      
      for (const dir of entries) {
        if (!dir.isDirectory()) continue;
        
        const mainPath = join(pluginsDir, dir.name, 'main.js');
        let loadedPlugin = this.plugins.get(dir.name);
        let modulePlugin: Plugin | null = null;
        
        if (!loadedPlugin) {
          try {
            const module = await import(`file://${mainPath}`);
            modulePlugin = module.default || module;
          } catch (e) {
            this.log.warn(`Failed to load plugin module: ${dir.name}`, e);
            continue;
          }
        }
        
        const plugin = loadedPlugin || modulePlugin;
        if (!plugin) continue;
        
        const config = this.pluginConfigs[dir.name];
        
        result.push({
          name: plugin.name || dir.name,
          version: plugin.version || '1.0.0',
          description: plugin.description,
          author: plugin.author,
          enabled: this.plugins.has(dir.name),
          options: config?.options || plugin.defaultConfig?.options,
          defaultConfig: plugin.defaultConfig,
          toolsCount: plugin.tools?.length || 0
        });
      }
    } catch (error) {
      this.log.error('Failed to scan plugins directory', error);
    }

    return result;
  }

  async enablePlugin(name: string, enabled: boolean): Promise<boolean> {
    const isLoaded = this.plugins.has(name);
    
    if (enabled && !isLoaded) {
      const config = this.pluginConfigs[name] || { enabled: false, options: {} };
      const plugin = await this.loadPluginModule(name, config.options);
      if (!plugin) {
        this.log.error(`Plugin not found: ${name}`);
        return false;
      }
      await this.loadPlugin(plugin);
      this.pluginConfigs[name] = { enabled: true, options: config.options };
      this.log.info(`Plugin ${name} enabled and loaded`);
    } else if (!enabled && isLoaded) {
      await this.unloadPlugin(name);
      this.pluginConfigs[name] = { enabled: false, options: this.pluginConfigs[name]?.options };
      this.log.info(`Plugin ${name} disabled and unloaded`);
    } else if (enabled && isLoaded) {
      this.pluginConfigs[name] = { enabled: true, options: this.pluginConfigs[name]?.options };
      const plugin = this.plugins.get(name);
      if (plugin?.onStart) {
        await plugin.onStart();
      }
    } else if (!enabled && !isLoaded) {
      this.pluginConfigs[name] = { enabled: false, options: this.pluginConfigs[name]?.options };
    }
    
    return true;
  }

  async updatePluginConfig(name: string, options: Record<string, any>): Promise<boolean> {
    const isLoaded = this.plugins.has(name);
    const currentConfig = this.pluginConfigs[name] || { enabled: false };
    
    this.pluginConfigs[name] = { ...currentConfig, options };
    
    if (isLoaded) {
      const plugin = this.plugins.get(name);
      if (plugin?.onLoad) {
        try {
          await plugin.onLoad({ ...plugin, options });
          this.log.info(`Plugin ${name} config updated (runtime)`);
        } catch (error) {
          this.log.error(`Failed to reload plugin config: ${name}`, error);
          return false;
        }
      }
    }
    
    return true;
  }

  setPluginConfigs(configs: Record<string, { enabled: boolean; options?: Record<string, any> }>): void {
    this.pluginConfigs = { ...configs };
  }

  getPluginConfigs(): Record<string, { enabled: boolean; options?: Record<string, any> }> {
    return this.pluginConfigs;
  }

  async applyDefaultConfigs(): Promise<Record<string, { enabled: boolean; options?: Record<string, any> }>> {
    const pluginsDir = join(process.cwd(), 'plugins');
    let changed = false;
    
    try {
      const fs = await import('fs/promises');
      const entries = await fs.readdir(pluginsDir, { withFileTypes: true });
      
      for (const dir of entries) {
        if (!dir.isDirectory()) continue;
        
        const mainPath = join(pluginsDir, dir.name, 'main.js');
        
        try {
          const module = await import(`file://${mainPath}`);
          const plugin = module.default || module;
          
          if (!this.pluginConfigs[dir.name] && plugin.defaultConfig) {
            this.pluginConfigs[dir.name] = {
              enabled: plugin.defaultConfig.enabled || false,
              options: plugin.defaultConfig.options || {}
            };
            changed = true;
            this.log.info(`Applied default config for plugin: ${dir.name}`);
          }
        } catch (e) {
          continue;
        }
      }
    } catch (error) {
      this.log.error('Failed to apply default configs', error);
    }
    
    return this.pluginConfigs;
  }
}
