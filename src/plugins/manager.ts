import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import { mkdir } from 'fs/promises';
import type { InboundMessage, OutboundMessage } from '../types.js';
import { logger as rootLogger } from '../platform/observability/index.js';
import { pathToFileURL } from 'url';
import {
  createPluginInstance,
  disposePluginInstance,
  matchCommand,
  type DiscoveredPlugin,
  type PluginInstance
} from './runtime.js';
import type {
  AgentAfterPayload,
  AgentBeforePayload,
  Plugin,
  PluginCommandExecutionResult,
  PluginConfigState,
  PluginDefinition,
  PluginErrorPayload,
  PluginInfo,
  PluginManagerOptions,
  PluginOptions,
  ToolAfterPayload,
  ToolBeforePayload
} from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneOptions(options?: PluginOptions): PluginOptions | undefined {
  return options ? structuredClone(options) : undefined;
}

function cloneConfigState(config?: PluginConfigState): PluginConfigState | undefined {
  if (!config) {
    return undefined;
  }
  return {
    enabled: config.enabled,
    options: cloneOptions(config.options)
  };
}

function getPluginAliases(name: string): string[] {
  return name.startsWith('plugin_') ? [name.slice('plugin_'.length)] : [];
}

function isPluginDefinition(value: unknown): value is PluginDefinition {
  return isRecord(value)
    && typeof value.name === 'string'
    && typeof value.version === 'string'
    && typeof value.setup === 'function';
}

async function importPluginModule<T = unknown>(modulePath: string): Promise<T> {
  const tmpDir = join(process.cwd(), '.tmp', 'tsx');
  await mkdir(tmpDir, { recursive: true });
  process.env.TMPDIR = tmpDir;
  process.env.TEMP = tmpDir;
  process.env.TMP = tmpDir;

  const { tsImport } = await import('tsx/esm/api');
  return tsImport(pathToFileURL(modulePath).href, { parentURL: import.meta.url }) as Promise<T>;
}

export class PluginManager {
  private readonly log;
  private readonly instances = new Map<string, PluginInstance>();
  private pluginConfigs: Record<string, PluginConfigState> = {};
  private discoveredPlugins: DiscoveredPlugin[] | null = null;

  constructor(private readonly options: PluginManagerOptions) {
    this.log = (options.logger ?? rootLogger).child('PluginManager');
  }

  async runCommands(message: InboundMessage): Promise<PluginCommandExecutionResult | null> {
    const content = message.content.trim();

    for (const instance of this.getActiveInstances()) {
      for (const command of instance.commands) {
        const { matched, args } = matchCommand(content, command);
        if (!matched) {
          continue;
        }

        try {
          const result = await command.execute(message, args);
          return result
            ? { type: 'reply', message: result }
            : { type: 'handled' };
        } catch (error) {
          this.log.error('插件命令执行失败', {
            plugin: instance.name,
            command: command.name,
            error
          });
        }
      }
    }

    return null;
  }

  async runMessageInHooks(message: InboundMessage): Promise<InboundMessage | null> {
    let current = message;

    for (const instance of this.getActiveInstances()) {
      for (const handler of instance.hooks.messageIn) {
        try {
          const next = await handler(current);
          if (next === null) {
            return null;
          }
          current = next;
        } catch (error) {
          this.log.error('插件消息入站钩子执行失败', {
            plugin: instance.name,
            error
          });
        }
      }
    }

    return current;
  }

  async runMessageOutHooks(message: OutboundMessage): Promise<OutboundMessage | null> {
    let current = message;

    for (const instance of this.getActiveInstances()) {
      for (const handler of instance.hooks.messageOut) {
        try {
          const next = await handler(current);
          if (next === null) {
            return null;
          }
          current = next;
        } catch (error) {
          this.log.error('插件消息出站钩子执行失败', {
            plugin: instance.name,
            error
          });
        }
      }
    }

    return current;
  }

  async runToolBeforeHooks(payload: ToolBeforePayload): Promise<ToolBeforePayload> {
    let current = payload;

    for (const instance of this.getActiveInstances()) {
      for (const handler of instance.hooks.toolBefore) {
        try {
          const next = await handler(current);
          if (next === null) {
            return current;
          }
          current = next;
        } catch (error) {
          this.log.error('插件工具前置钩子执行失败', {
            plugin: instance.name,
            toolName: current.toolName,
            error
          });
        }
      }
    }

    return current;
  }

  async runToolAfterHooks(payload: ToolAfterPayload): Promise<ToolAfterPayload> {
    let current = payload;

    for (const instance of this.getActiveInstances()) {
      for (const handler of instance.hooks.toolAfter) {
        try {
          const next = await handler(current);
          if (next === null) {
            return current;
          }
          current = next;
        } catch (error) {
          this.log.error('插件工具后置钩子执行失败', {
            plugin: instance.name,
            toolName: current.toolName,
            error
          });
        }
      }
    }

    return current;
  }

  async runAgentBeforeTaps(payload: AgentBeforePayload): Promise<void> {
    await this.runTapHooks('agentBefore', payload);
  }

  async runAgentAfterTaps(payload: AgentAfterPayload): Promise<void> {
    await this.runTapHooks('agentAfter', payload);
  }

  async runErrorTaps(error: unknown, context: PluginErrorPayload['context']): Promise<void> {
    const normalized = error instanceof Error ? error : new Error(String(error));
    await this.runTapHooks('error', {
      error: normalized,
      context
    });
  }

  async dispatchMessage(message: OutboundMessage, options: { skipHooks?: boolean } = {}): Promise<void> {
    if (options.skipHooks) {
      await this.options.publishOutbound(message);
      return;
    }

    const processed = await this.runMessageOutHooks(message);
    if (processed === null) {
      return;
    }

    await this.options.publishOutbound(processed);
  }

  async loadFromConfig(configs: Record<string, PluginConfigState>): Promise<void> {
    this.setPluginConfigs(configs);
    const discovered = await this.ensureDiscovered();

    for (const discovery of discovered) {
      const { state } = this.getConfiguredState(discovery.name, discovery.definition);
      if (state.enabled) {
        if (!this.instances.has(discovery.name)) {
          await this.activate(discovery, state.options);
        }
        continue;
      }

      await this.deactivate(discovery.name);
    }
  }

  async applyDefaultConfigs(): Promise<{
    pluginConfigs: Record<string, PluginConfigState>;
    changed: boolean;
  }> {
    const discovered = await this.ensureDiscovered();
    let changed = false;

    for (const discovery of discovered) {
      const existing = this.getExistingConfig(discovery.name);
      if (existing) {
        continue;
      }

      changed = true;
      this.pluginConfigs[discovery.name] = {
        enabled: discovery.definition.defaultConfig?.enabled ?? false,
        options: cloneOptions(discovery.definition.defaultConfig?.options)
      };
    }

    return {
      pluginConfigs: this.getPluginConfigs(),
      changed
    };
  }

  async getAllPlugins(): Promise<PluginInfo[]> {
    const discovered = await this.ensureDiscovered();

    return discovered.map((discovery) => {
      const instance = this.instances.get(discovery.name);
      const { state } = this.getConfiguredState(discovery.name, discovery.definition);

      return {
        name: discovery.definition.name || discovery.name,
        version: discovery.definition.version,
        description: discovery.definition.description,
        author: discovery.definition.author,
        enabled: this.instances.has(discovery.name),
        options: cloneOptions(state.options) ?? cloneOptions(discovery.definition.defaultConfig?.options),
        defaultConfig: discovery.definition.defaultConfig,
        toolsCount: instance?.tools.length ?? discovery.definition.toolsCount ?? 0
      };
    });
  }

  async enablePlugin(name: string, enabled: boolean): Promise<boolean> {
    const discovery = await this.findDiscoveredPlugin(name);
    if (!discovery) {
      return false;
    }

    const { key, state } = this.getConfiguredState(discovery.name, discovery.definition);
    const previousState = cloneConfigState(state) ?? {
      enabled: false,
      options: cloneOptions(discovery.definition.defaultConfig?.options)
    };
    const nextState: PluginConfigState = {
      enabled,
      options: cloneOptions(previousState.options) ?? cloneOptions(discovery.definition.defaultConfig?.options)
    };

    this.pluginConfigs[key] = nextState;

    if (enabled && this.instances.has(discovery.name)) {
      return true;
    }

    if (!enabled && !this.instances.has(discovery.name)) {
      return true;
    }

    try {
      if (!enabled) {
        await this.deactivate(discovery.name);
        return true;
      }

      await this.activate(discovery, nextState.options);
      return true;
    } catch (error) {
      this.pluginConfigs[key] = previousState;
      this.log.error('插件启停切换失败', {
        plugin: discovery.name,
        enabled,
        error
      });

      if (previousState.enabled) {
        try {
          await this.activate(discovery, previousState.options);
        } catch (restoreError) {
          this.log.error('插件回滚恢复失败', {
            plugin: discovery.name,
            error: restoreError
          });
        }
      }

      return false;
    }
  }

  async updatePluginConfig(name: string, options: PluginOptions): Promise<boolean> {
    const discovery = await this.findDiscoveredPlugin(name);
    if (!discovery) {
      return false;
    }

    const { key, state } = this.getConfiguredState(discovery.name, discovery.definition);
    const previousState = cloneConfigState(state) ?? {
      enabled: false,
      options: cloneOptions(discovery.definition.defaultConfig?.options)
    };
    const nextState: PluginConfigState = {
      enabled: previousState.enabled,
      options: cloneOptions(options)
    };

    this.pluginConfigs[key] = nextState;

    if (!this.instances.has(discovery.name)) {
      return true;
    }

    try {
      await this.deactivate(discovery.name);
      await this.activate(discovery, nextState.options);
      return true;
    } catch (error) {
      this.pluginConfigs[key] = previousState;
      this.log.error('插件配置重建失败', {
        plugin: discovery.name,
        error
      });

      if (previousState.enabled) {
        try {
          await this.activate(discovery, previousState.options);
        } catch (restoreError) {
          this.log.error('插件回滚恢复失败', {
            plugin: discovery.name,
            error: restoreError
          });
        }
      }

      return false;
    }
  }

  setPluginConfigs(configs: Record<string, PluginConfigState>): void {
    this.pluginConfigs = Object.fromEntries(
      Object.entries(configs).map(([name, config]) => [
        name,
        {
          enabled: config.enabled,
          options: cloneOptions(config.options)
        }
      ])
    );
  }

  getPluginConfigs(): Record<string, PluginConfigState> {
    return Object.fromEntries(
      Object.entries(this.pluginConfigs).map(([name, config]) => [
        name,
        {
          enabled: config.enabled,
          options: cloneOptions(config.options)
        }
      ])
    );
  }

  private async runTapHooks(
    hookName: keyof PluginInstance['hooks'],
    payload: AgentBeforePayload | AgentAfterPayload | PluginErrorPayload
  ): Promise<void> {
    for (const instance of this.getActiveInstances()) {
      const handlers = instance.hooks[hookName];
      for (const handler of handlers) {
        try {
          await handler(payload as never);
        } catch (error) {
          this.log.error('插件监听钩子执行失败', {
            plugin: instance.name,
            hook: hookName,
            error
          });
        }
      }
    }
  }

  private getActiveInstances(): PluginInstance[] {
    return Array.from(this.instances.values()).sort((left, right) => left.order - right.order);
  }

  private getExistingConfig(name: string): { key: string; state: PluginConfigState } | null {
    if (this.pluginConfigs[name]) {
      return { key: name, state: this.pluginConfigs[name] };
    }

    for (const alias of getPluginAliases(name)) {
      if (this.pluginConfigs[alias]) {
        return { key: alias, state: this.pluginConfigs[alias] };
      }
    }

    return null;
  }

  private getConfiguredState(name: string, definition: PluginDefinition): { key: string; state: PluginConfigState } {
    const existing = this.getExistingConfig(name);
    if (existing) {
      return existing;
    }

    return {
      key: name,
      state: {
        enabled: definition.defaultConfig?.enabled ?? false,
        options: cloneOptions(definition.defaultConfig?.options)
      }
    };
  }

  private async activate(discovery: DiscoveredPlugin, options?: PluginOptions): Promise<void> {
    await this.deactivate(discovery.name);

    const instance = await createPluginInstance({
      discovery,
      options,
      getConfig: this.options.getConfig,
      workspace: this.options.workspace,
      tempDir: this.options.tempDir,
      logger: this.log,
      toolRegistry: this.options.toolRegistry,
      dispatchMessage: (message, sendOptions) => this.dispatchMessage(message, sendOptions)
    });

    this.instances.set(discovery.name, instance);
    this.log.info('插件已启用', {
      plugin: discovery.name,
      toolCount: instance.tools.length
    });
  }

  private async deactivate(name: string): Promise<void> {
    const instance = this.instances.get(name);
    if (!instance) {
      return;
    }

    await disposePluginInstance(instance, this.options.toolRegistry, this.log);
    this.instances.delete(name);
    this.log.info('插件已停用', { plugin: name });
  }

  private async findDiscoveredPlugin(name: string): Promise<DiscoveredPlugin | null> {
    const discovered = await this.ensureDiscovered();
    return discovered.find((plugin) => plugin.name === name || getPluginAliases(plugin.name).includes(name)) ?? null;
  }

  private async ensureDiscovered(): Promise<DiscoveredPlugin[]> {
    if (this.discoveredPlugins) {
      return this.discoveredPlugins;
    }

    const pluginsDir = join(process.cwd(), 'plugins');
    let entries: Array<{ name: string; sourcePath: string }> = [];

    try {
      const dirents = await readdir(pluginsDir, { withFileTypes: true });
      const pluginDirs = dirents
        .filter((dirent) => dirent.isDirectory() && dirent.name.startsWith('plugin_'))
        .map((dirent) => dirent.name)
        .sort((left, right) => left.localeCompare(right));

      for (const name of pluginDirs) {
        const sourcePath = join(pluginsDir, name, 'main.ts');
        try {
          const sourceStat = await stat(sourcePath);
          if (sourceStat.isFile()) {
            entries.push({ name, sourcePath });
          }
        } catch {
          continue;
        }
      }
    } catch (error) {
      this.log.error('扫描插件目录失败', { error });
      this.discoveredPlugins = [];
      return this.discoveredPlugins;
    }

    const discovered: DiscoveredPlugin[] = [];
    for (const [order, entry] of entries.entries()) {
      try {
        const module = await importPluginModule<Record<string, unknown>>(entry.sourcePath);
        const plugin = (module.default ?? module) as unknown;
        if (!isPluginDefinition(plugin)) {
          this.log.warn('插件模块无效，已跳过', {
            plugin: entry.name
          });
          continue;
        }

        discovered.push({
          name: entry.name,
          sourcePath: entry.sourcePath,
          order,
          definition: plugin as Plugin
        });
      } catch (error) {
        this.log.error('导入插件模块失败', {
          plugin: entry.name,
          error
        });
      }
    }

    this.discoveredPlugins = discovered;
    return discovered;
  }
}
