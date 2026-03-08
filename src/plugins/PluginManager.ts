import type { InboundMessage, OutboundMessage, Config, LLMMessage, LLMResponse, PluginErrorContext } from '../types.js';
import type { EventBus } from '../bus/EventBus.js';
import type { AgentLoop } from '../agent/AgentLoop.js';
import type { ToolRegistry, Tool, ToolContext } from '../tools/ToolRegistry.js';
import { logger } from '../logger/index.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { HookPipeline, VoidHookPipeline } from './HookPipeline.js';

/**
 * Command matcher types
 */
export type CommandMatcher =
  | { type: 'regex'; value: RegExp }
  | { type: 'prefix'; value: string }
  | { type: 'exact'; value: string }
  | { type: 'contains'; value: string };

/**
 * Command definition for plugin command handlers
 */
export interface PluginCommand {
  /** Unique command name */
  name: string;
  /** Human-readable command description */
  description: string;
  /** Matcher for command - supports regex, prefix, exact, and contains */
  matcher?: CommandMatcher;
  /** Handler function when command is matched */
  handler: (msg: InboundMessage, args: string[]) => Promise<InboundMessage | null>;
}

/**
 * Helper function to test if a command matches the content
 */
function matchCommand(content: string, cmd: PluginCommand): { matched: boolean; args: string[] } {
  if (cmd.matcher) {
    switch (cmd.matcher.type) {
      case 'regex': {
        const match = content.match(cmd.matcher.value);
        if (match) {
          return { matched: true, args: match.slice(1) };
        }
        break;
      }
      case 'prefix':
        if (content.startsWith(cmd.matcher.value)) {
          const args = content.slice(cmd.matcher.value.length).trim().split(/\s+/);
          return { matched: true, args: args[0] ? args : [] };
        }
        break;
      case 'exact':
        if (content === cmd.matcher.value) {
          return { matched: true, args: [] };
        }
        break;
      case 'contains':
        if (content.includes(cmd.matcher.value)) {
          const parts = content.split(cmd.matcher.value);
          const args = parts.at(1)?.trim().split(/\s+/) || [];
          return { matched: true, args: args };
        }
        break;
    }
  }

  return { matched: false, args: [] };
}

/**
 * Plugin interface for extending AesyClaw functionality
 */
export interface Plugin {
  /** Unique plugin identifier */
  name: string;
  /** Plugin version string */
  version: string;
  /** Optional plugin description */
  description?: string;
  /** Plugin author name */
  author?: string;
  /** Runtime configuration options */
  options?: Record<string, any>;
  /** Default configuration for the plugin */
  defaultConfig?: Record<string, any>;

  /** Called when plugin is loaded */
  onLoad?(options?: Record<string, any>): Promise<void>;
  /** Called when plugin is unloaded */
  onUnload?(): Promise<void>;

  /** Called for each inbound message */
  onMessage?(msg: InboundMessage): Promise<InboundMessage | null>;
  /** Called for each outbound message */
  onResponse?(msg: OutboundMessage): Promise<OutboundMessage | null>;

  /** Called before agent processes message */
  onAgentBefore?(msg: InboundMessage, messages: LLMMessage[]): Promise<void>;
  /** Called after agent generates response */
  onAgentAfter?(msg: InboundMessage, response: LLMResponse): Promise<void>;
  /** Called before tool execution, can mutate params */
  onBeforeToolCall?(toolName: string, params: Record<string, any>, context?: ToolContext): Promise<Record<string, any> | void>;
  /** Called after tool execution */
  onToolCall?(toolName: string, params: Record<string, any>, result: string, context?: ToolContext): Promise<string | void>;
  /** Called when an error occurs */
  onError?(error: Error, context: PluginErrorContext): Promise<void>;

  /** Called when plugin is enabled/start */
  onStart?(): Promise<void>;
  /** Called when plugin is disabled/stopped */
  onStop?(): Promise<void>;

  /** Commands exposed by this plugin */
  commands?: PluginCommand[];
  /** Tools exposed by this plugin */
  tools?: Tool[];
}

/**
 * Context object passed to plugins containing available services and utilities
 */
export interface PluginContext {
  /** Application configuration */
  config: Config;
  /** Event bus for publishing/consuming messages */
  eventBus: EventBus;
  /** Agent loop instance */
  agent: AgentLoop | null;
  /** Working directory path */
  workspace: string;
  /** Temporary directory path for plugin temporary files */
  tempDir: string;
  /** Register a tool to make it available to the agent */
  registerTool(tool: Tool): void;
  /** Get the tool registry instance */
  getToolRegistry(): ToolRegistry;
  /** Logger instance for plugin logging */
  logger: typeof logger;
  /** Send a message to a channel */
  sendMessage(channel: string, chatId: string, content: string, messageType?: 'private' | 'group'): Promise<void>;
  /** Plugin-specific options from config */
  options?: Record<string, any>;
}

/**
 * Configuration for loading a plugin from config
 */
export interface PluginLoaderConfig {
  /** Plugin name */
  name: string;
  /** Whether plugin is enabled */
  enabled: boolean;
  /** Optional plugin-specific options */
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
        let msg: OutboundMessage = {
          channel,
          chatId,
          content,
          messageType: messageType || 'private'
        };

        // Apply onResponse hooks for consistency
        msg = await this.applyOnResponse(msg) || msg;

        await context.eventBus.publishOutbound(msg);
      }
    };
    this.toolRegistry = toolRegistry;
  }

  async applyOnCommand(msg: InboundMessage): Promise<InboundMessage | null> {
    const content = msg.content.trim();

    for (const plugin of this.plugins.values()) {
      if (!plugin.commands) continue;

      for (const cmd of plugin.commands) {
        const { matched, args } = matchCommand(content, cmd);
        if (matched) {
          this.log.debug(`Command ${cmd.name} matched by plugin ${plugin.name}`);
          try {
            const result = await cmd.handler(msg, args);
            return result;
          } catch (error) {
            this.log.error(`Plugin ${plugin.name} command ${cmd.name} error:`, error);
          }
        }
      }
    }

    return null;
  }

  async applyOnMessage(msg: InboundMessage): Promise<InboundMessage | null> {
    this.log.info(`applyOnMessage called with: content="${msg.content}", media=${JSON.stringify(msg.media)}`);
    this.log.debug(`Message details: channel=${msg.channel}, chatId=${msg.chatId}, senderId=${msg.senderId}`);

    const pipeline = new HookPipeline<InboundMessage>(
      Array.from(this.plugins.values()),
      'onMessage',
      { verbose: true }
    );

    const result = await pipeline.execute(msg);
    this.log.info(`applyOnMessage returning: ${JSON.stringify({ content: result.content.substring(0, 50) })}`);
    this.log.debug(`Message modified: ${result.content !== msg.content}`);
    return result;
  }

  async applyOnResponse(msg: OutboundMessage): Promise<OutboundMessage | null> {
    const pipeline = new HookPipeline<OutboundMessage>(
      Array.from(this.plugins.values()),
      'onResponse'
    );

    return pipeline.execute(msg);
  }

  async applyOnAgentBefore(msg: InboundMessage, messages: LLMMessage[]): Promise<void> {
    const pipeline = new VoidHookPipeline(
      Array.from(this.plugins.values()),
      'onAgentBefore'
    );

    await pipeline.execute(msg, messages);
  }

  async applyOnAgentAfter(msg: InboundMessage, response: LLMResponse): Promise<void> {
    const pipeline = new VoidHookPipeline(
      Array.from(this.plugins.values()),
      'onAgentAfter'
    );

    await pipeline.execute(msg, response);
  }

  async applyOnBeforeToolCall(toolName: string, params: Record<string, any>, context?: ToolContext): Promise<Record<string, any>> {
    this.log.debug(`applyOnBeforeToolCall: tool=${toolName}, params keys=${Object.keys(params).join(', ')}`);

    const pipeline = new HookPipeline<Record<string, any>>(
      Array.from(this.plugins.values()),
      'onBeforeToolCall'
    );

    const result = await pipeline.execute(params, toolName, context);
    this.log.debug(`After onBeforeToolCall hooks, params keys=${Object.keys(result).join(', ')}`);
    return result;
  }

  async applyOnToolCall(toolName: string, params: Record<string, any>, result: string, context?: ToolContext): Promise<string> {
    const pipeline = new HookPipeline<string>(
      Array.from(this.plugins.values()),
      'onToolCall'
    );

    return pipeline.execute(result, toolName, params, context);
  }

  async applyOnError(error: unknown, context: PluginErrorContext): Promise<void> {
    const err = error instanceof Error ? error : new Error(String(error));

    const pipeline = new VoidHookPipeline(
      Array.from(this.plugins.values()),
      'onError'
    );

    await pipeline.execute(err, { ...context });
  }

  private buildPluginContext(options?: Record<string, any>): PluginContext {
    return {
      options,
      config: this.context.config,
      eventBus: this.context.eventBus,
      tempDir: this.context.tempDir,
      logger: this.context.logger,
      workspace: this.context.workspace,
      agent: this.context.agent,
      registerTool: this.context.registerTool,
      getToolRegistry: this.context.getToolRegistry,
      sendMessage: this.context.sendMessage
    };
  }

  async loadPlugin(plugin: Plugin): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      this.log.warn(`Plugin ${plugin.name} already loaded`);
      return;
    }

    this.log.info(`Loading plugin: ${plugin.name} v${plugin.version}, has onResponse: ${!!plugin.onResponse}`);

    if (plugin.onLoad) {
      await plugin.onLoad(this.buildPluginContext(plugin.options));
      this.log.debug(`Plugin ${plugin.name} onLoad completed with options:`, plugin.options);
    }

    if (plugin.tools) {
      const pluginAny = plugin as any;
      for (const tool of plugin.tools) {
        const toolName = tool.name; // 捕获工具名称
        const toolExecute = tool.execute; // 捕获执行函数
        const wrappedTool = {
          ...tool,
          source: 'plugin' as const,
          execute: async (params: Record<string, any>, context?: any) => {
            return toolExecute.call(plugin, params, context);
          }
        };
        this.toolRegistry.register(wrappedTool, 'plugin');
        this.log.debug(`Registered tool from ${plugin.name}: ${toolName}, has config: ${!!pluginAny.config}`);
      }
    }

    if (plugin.onStart) {
      await plugin.onStart();
    }

    this.plugins.set(plugin.name, plugin);
    this.log.info(`Loaded plugin: ${plugin.name}, has onResponse: ${!!plugin.onResponse}`);
  }

  updateAgent(agent: AgentLoop): void {
    this.context.agent = agent;
    for (const plugin of this.plugins.values()) {
      const p = plugin as any;
      if (p.context) {
        p.context.agent = agent;
      }
    }
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

  async reloadPlugin(name: string): Promise<boolean> {
    const config = this.pluginConfigs[name];
    const oldPlugin = this.plugins.get(name);
    const wasEnabled = !!oldPlugin;
    const options = config?.options ?? {};

    this.log.info(`Reloading plugin: ${name}, wasEnabled: ${wasEnabled}, options:`, options);

    const oldStates = oldPlugin ? (oldPlugin as any).waitingStates : null;
    const oldStatesMap = oldStates instanceof Map ? Object.fromEntries(oldStates) : null;

    if (wasEnabled) {
      await this.unloadPlugin(name);
    }

    const plugin = await this.loadPluginModule(name, options);
    if (!plugin) {
      this.log.error(`Failed to reload plugin ${name}: module not found`);
      return false;
    }

    await this.loadPlugin(plugin);

    if (oldStatesMap) {
      const newPlugin = this.plugins.get(name);
      const newStates = newPlugin ? (newPlugin as any).waitingStates : null;
      if (newStates instanceof Map) {
        const timeoutMs = (newPlugin as any).timeoutMs || 5 * 60 * 1000;
        for (const [key, state] of Object.entries(oldStatesMap)) {
          const s = state as { timestamp: number; files: string[] };
          if (Date.now() - s.timestamp < timeoutMs) {
            newStates.set(key, s);
          }
        }
        this.log.info(`Restored ${newStates.size} states for plugin ${name}`);
      }
    }

    if (!wasEnabled) {
      await this.unloadPlugin(name);
      this.pluginConfigs[name] = { enabled: false, options };
    }

    this.log.info(`Reloaded plugin: ${name}`);
    return true;
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
        } catch (error) {
          continue;
        }

        if (!modulePlugin) continue;

        const pluginConfig = config[dir.name];
        let enabled = false;
        let options: Record<string, any> = {};

        if (pluginConfig?.enabled) {
          enabled = true;
          options = pluginConfig.options ?? {};
        } else if (modulePlugin.defaultConfig?.enabled === true) {
          enabled = true;
          options = modulePlugin.defaultConfig?.options ?? {};
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
          } catch (error) {
            this.log.warn(`Failed to load plugin module: ${dir.name}`, error);
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
          await plugin.onLoad(this.buildPluginContext(options));
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
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      this.log.error('Failed to apply default configs', error);
    }

    return this.pluginConfigs;
  }
}
