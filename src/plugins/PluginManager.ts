import type { InboundMessage, OutboundMessage, Config, LLMMessage, LLMResponse, PluginErrorContext } from '../types.js';
import type { EventBus } from '../bus/EventBus.js';
import type { AgentLoop } from '../agent/index.js';
import type { ToolRegistry, Tool, ToolContext } from '../tools/ToolRegistry.js';
import { logger } from '../logger/index.js';
import { join } from 'path';
import { stat } from 'fs/promises';
import { importExternalModule } from '../utils/importExternalModule.js';

interface PluginModuleEntry {
  name: string;
  sourcePath: string;
}

const PLUGIN_IMPORT_CONCURRENCY = 2;

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  let nextIndex = 0;
  const limit = Math.max(1, Math.min(concurrency, items.length));

  const runners = Array.from({ length: limit }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      await worker(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(runners);
}

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
          try {
            const result = await cmd.handler(msg, args);
            return result;
          } catch (error) {
            this.log.error('Plugin command failed', {
              plugin: plugin.name,
              command: cmd.name,
              error
            });
          }
        }
      }
    }

    return null;
  }

  private async runTransformHooks<T>(
    hookName: keyof Plugin,
    initial: T,
    options: { verbose?: boolean } = {},
    ...args: any[]
  ): Promise<T> {
    let result = initial;

    for (const plugin of this.plugins.values()) {
      const hook = plugin[hookName];
      if (typeof hook !== 'function') {
        continue;
      }

      try {
        const hookResult = await (hook as (...hookArgs: any[]) => Promise<T | null | undefined>).call(plugin, result, ...args);

        if (hookResult !== undefined && hookResult !== null) {
          result = hookResult;
        }
      } catch (error) {
        this.log.error('Plugin hook failed', {
          plugin: plugin.name,
          hook: String(hookName),
          error
        });
      }
    }

    return result;
  }

  private async runObserverHooks(
    hookName: keyof Plugin,
    ...args: any[]
  ): Promise<void> {
    for (const plugin of this.plugins.values()) {
      const hook = plugin[hookName];
      if (typeof hook !== 'function') {
        continue;
      }

      try {
        await (hook as (...hookArgs: any[]) => Promise<void>).call(plugin, ...args);
      } catch (error) {
        this.log.error('Plugin hook failed', {
          plugin: plugin.name,
          hook: String(hookName),
          error
        });
      }
    }
  }

  async applyOnMessage(msg: InboundMessage): Promise<InboundMessage | null> {
    return this.runTransformHooks('onMessage', msg, { verbose: true });
  }

  async applyOnResponse(msg: OutboundMessage): Promise<OutboundMessage | null> {
    return this.runTransformHooks('onResponse', msg);
  }

  async applyOnAgentBefore(msg: InboundMessage, messages: LLMMessage[]): Promise<void> {
    await this.runObserverHooks('onAgentBefore', msg, messages);
  }

  async applyOnAgentAfter(msg: InboundMessage, response: LLMResponse): Promise<void> {
    await this.runObserverHooks('onAgentAfter', msg, response);
  }

  async applyOnBeforeToolCall(toolName: string, params: Record<string, any>, context?: ToolContext): Promise<Record<string, any>> {
    const result = await this.runTransformHooks('onBeforeToolCall', params, {}, toolName, context);
    return result;
  }

  async applyOnToolCall(toolName: string, params: Record<string, any>, result: string, context?: ToolContext): Promise<string> {
    return this.runTransformHooks('onToolCall', result, {}, toolName, params, context);
  }

  async applyOnError(error: unknown, context: PluginErrorContext): Promise<void> {
    const err = error instanceof Error ? error : new Error(String(error));
    await this.runObserverHooks('onError', err, { ...context });
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

    this.log.info('Loading plugin', {
      plugin: plugin.name,
      version: plugin.version,
      hasTools: !!plugin.tools?.length,
      hasOnResponse: !!plugin.onResponse
    });

    if (plugin.onLoad) {
      await plugin.onLoad(this.buildPluginContext(plugin.options));
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
      }
    }

    if (plugin.onStart) {
      await plugin.onStart();
    }

    this.plugins.set(plugin.name, plugin);
    this.log.info('Plugin loaded', {
      plugin: plugin.name,
      toolCount: plugin.tools?.length || 0,
      hasOnResponse: !!plugin.onResponse
    });
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
    this.log.info('Plugin unloaded', { plugin: name });
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

  private getPluginsDir(): string {
    return join(process.cwd(), 'plugins');
  }

  private getPluginAliases(name: string): string[] {
    if (name.startsWith('plugin_')) {
      return [name.slice('plugin_'.length)];
    }

    return [];
  }

  private getConfiguredPlugin(
    configs: Record<string, { enabled: boolean; options?: Record<string, any> }>,
    name: string
  ): { key: string; config: { enabled: boolean; options?: Record<string, any> } } | null {
    if (configs[name]) {
      return { key: name, config: configs[name] };
    }

    for (const alias of this.getPluginAliases(name)) {
      if (configs[alias]) {
        return { key: alias, config: configs[alias] };
      }
    }

    return null;
  }

  private async hasSourceEntry(dirName: string): Promise<boolean> {
    const mainPath = join(this.getPluginsDir(), dirName, 'main.ts');

    try {
      const mainStat = await stat(mainPath);
      return mainStat.isFile();
    } catch {
      return false;
    }
  }

  private async resolvePluginModulePath(name: string): Promise<string> {
    const sourcePath = join(this.getPluginsDir(), name, 'main.ts');
    return sourcePath;
  }

  private async discoverPluginEntries(): Promise<PluginModuleEntry[]> {
    const pluginsDir = this.getPluginsDir();
    const fs = await import('fs/promises');
    const entries = await fs.readdir(pluginsDir, { withFileTypes: true });
    const pluginEntries: PluginModuleEntry[] = [];

    for (const dir of entries) {
      if (!dir.isDirectory() || !dir.name.startsWith('plugin_')) {
        continue;
      }

      const hasEntry = await this.hasSourceEntry(dir.name);
      if (!hasEntry) {
        continue;
      }

      pluginEntries.push({
        name: dir.name,
        sourcePath: join(pluginsDir, dir.name, 'main.ts')
      });
    }

    return pluginEntries;
  }

  private async importPluginModule(mainPath: string): Promise<Plugin | null> {
    try {
      const module = await importExternalModule<Record<string, unknown>>(mainPath) as Record<string, any>;
      return (module.default || module) as Plugin;
    } catch {
      return null;
    }
  }

  async loadFromConfig(config: Record<string, any>): Promise<void> {
    try {
      const pluginEntries = await this.discoverPluginEntries();

      await mapWithConcurrency(pluginEntries, PLUGIN_IMPORT_CONCURRENCY, async (entry) => {
        const modulePlugin = await this.importPluginModule(entry.sourcePath);

        if (!modulePlugin) return;

        const configuredPlugin = this.getConfiguredPlugin(config, entry.name);
        const pluginConfig = configuredPlugin?.config;
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
            modulePlugin.options = options;
            await this.loadPlugin(modulePlugin);
          } catch (error) {
            this.log.error(`Failed to load plugin ${entry.name}:`, error);
          }
        }
      });
    } catch (error) {
      this.log.error('Failed to scan plugins directory', error);
    }
  }

  private async loadPluginModule(name: string, options?: Record<string, any>): Promise<Plugin | null> {
    const pluginPath = await this.resolvePluginModulePath(name);

    try {
      this.log.debug(`Loading plugin from: ${pluginPath}`);
      const module = await importExternalModule<Record<string, unknown>>(pluginPath) as Record<string, any>;
      const plugin = (module.default || module) as Plugin & { options?: Record<string, any> };
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
      const pluginEntries = await this.discoverPluginEntries();

      for (const entry of pluginEntries) {
        let loadedPlugin = this.plugins.get(entry.name);
        let modulePlugin: Plugin | null = null;

        if (!loadedPlugin) {
          modulePlugin = await this.importPluginModule(entry.sourcePath);
          if (!modulePlugin) {
            this.log.warn(`Failed to load plugin module: ${entry.name}`);
            continue;
          }
        }

        const plugin = loadedPlugin || modulePlugin;
        if (!plugin) continue;

        const config = this.getConfiguredPlugin(this.pluginConfigs, entry.name)?.config;

        result.push({
          name: plugin.name || entry.name,
          version: plugin.version || '1.0.0',
          description: plugin.description,
          author: plugin.author,
          enabled: this.plugins.has(entry.name),
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
    try {
      const pluginEntries = await this.discoverPluginEntries();

      await mapWithConcurrency(pluginEntries, PLUGIN_IMPORT_CONCURRENCY, async (entry) => {
        const plugin = await this.importPluginModule(entry.sourcePath);
        if (!plugin) {
          return;
        }

        if (!this.getConfiguredPlugin(this.pluginConfigs, entry.name) && plugin.defaultConfig) {
          this.pluginConfigs[entry.name] = {
              enabled: plugin.defaultConfig.enabled || false,
              options: plugin.defaultConfig.options || {}
          };
          this.log.info(`Applied default config for plugin: ${entry.name}`);
        }
      });
    } catch (error) {
      this.log.error('Failed to apply default configs', error);
    }

    return this.pluginConfigs;
  }
}
