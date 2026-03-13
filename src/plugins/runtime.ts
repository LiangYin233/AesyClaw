import type { Config, InboundMessage, OutboundMessage } from '../types.js';
import type { Logger } from '../observability/index.js';
import type { ToolRegistry } from '../tools/ToolRegistry.js';
import type {
  AgentAfterPayload,
  AgentBeforePayload,
  PluginCommand,
  PluginContext,
  PluginDefinition,
  PluginErrorPayload,
  PluginOptions,
  PluginTeardown,
  SendMessageOptions,
  ToolAfterPayload,
  ToolBeforePayload
} from './types.js';

export interface DiscoveredPlugin {
  name: string;
  sourcePath: string;
  order: number;
  definition: PluginDefinition;
}

export interface PluginHookState {
  messageIn: Array<(message: InboundMessage) => Promise<InboundMessage | null> | InboundMessage | null>;
  messageOut: Array<(message: OutboundMessage) => Promise<OutboundMessage | null> | OutboundMessage | null>;
  toolBefore: Array<(payload: ToolBeforePayload) => Promise<ToolBeforePayload | null> | ToolBeforePayload | null>;
  toolAfter: Array<(payload: ToolAfterPayload) => Promise<ToolAfterPayload | null> | ToolAfterPayload | null>;
  agentBefore: Array<(payload: AgentBeforePayload) => Promise<void> | void>;
  agentAfter: Array<(payload: AgentAfterPayload) => Promise<void> | void>;
  error: Array<(payload: PluginErrorPayload) => Promise<void> | void>;
}

export interface PluginInstance {
  name: string;
  order: number;
  definition: PluginDefinition;
  options: PluginOptions;
  commands: PluginCommand[];
  tools: PluginContext['tools'] extends { register(tool: infer T): void } ? T[] : never;
  hooks: PluginHookState;
  teardown?: PluginTeardown | undefined;
}

export interface CreatePluginInstanceOptions {
  discovery: DiscoveredPlugin;
  options?: PluginOptions;
  getConfig: () => Config;
  workspace: string;
  tempDir: string;
  logger: Logger;
  toolRegistry: ToolRegistry;
  dispatchMessage(message: OutboundMessage, options?: SendMessageOptions): Promise<void>;
}

function cloneOptions<T extends PluginOptions | undefined>(options: T): T {
  if (!options) {
    return options;
  }
  return structuredClone(options);
}

function createHookState(): PluginHookState {
  return {
    messageIn: [],
    messageOut: [],
    toolBefore: [],
    toolAfter: [],
    agentBefore: [],
    agentAfter: [],
    error: []
  };
}

export async function createPluginInstance(options: CreatePluginInstanceOptions): Promise<PluginInstance> {
  const { discovery, getConfig, workspace, tempDir, logger, dispatchMessage, toolRegistry } = options;
  const pluginOptions = cloneOptions(options.options) ?? {};
  const commands: PluginCommand[] = [];
  const tools: PluginInstance['tools'] = [];
  const hooks = createHookState();

  const context: PluginContext = {
    config: Object.freeze(structuredClone(getConfig())),
    options: Object.freeze(pluginOptions),
    workspace,
    tempDir,
    logger: logger.child(discovery.definition.name),
    sendMessage: (message, sendOptions) => dispatchMessage(message, sendOptions),
    tools: {
      register(tool) {
        tools.push(tool);
      }
    },
    commands: {
      register(command) {
        commands.push(command);
      }
    },
    hooks: {
      messageIn: {
        transform(handler) {
          hooks.messageIn.push(handler);
        }
      },
      messageOut: {
        transform(handler) {
          hooks.messageOut.push(handler);
        }
      },
      toolBefore: {
        transform(handler) {
          hooks.toolBefore.push(handler);
        }
      },
      toolAfter: {
        transform(handler) {
          hooks.toolAfter.push(handler);
        }
      },
      agentBefore: {
        tap(handler) {
          hooks.agentBefore.push(handler);
        }
      },
      agentAfter: {
        tap(handler) {
          hooks.agentAfter.push(handler);
        }
      },
      error: {
        tap(handler) {
          hooks.error.push(handler);
        }
      }
    }
  };

  const setupResult = await discovery.definition.setup(context);
  const teardown = typeof setupResult === 'function' ? setupResult : undefined;

  for (const tool of tools) {
    toolRegistry.register(tool, 'plugin');
  }

  return {
    name: discovery.name,
    order: discovery.order,
    definition: discovery.definition,
    options: pluginOptions,
    commands,
    tools,
    hooks,
    teardown
  };
}

export async function disposePluginInstance(
  instance: PluginInstance,
  toolRegistry: ToolRegistry,
  logger: Logger
): Promise<void> {
  try {
    await instance.teardown?.();
  } catch (error) {
    logger.error('Plugin teardown failed', {
      plugin: instance.name,
      error
    });
  }

  if (instance.tools.length > 0) {
    toolRegistry.unregisterMany(instance.tools.map((tool) => tool.name));
  }
}

export function matchCommand(content: string, command: PluginCommand): { matched: boolean; args: string[] } {
  if (!command.matcher) {
    return { matched: false, args: [] };
  }

  switch (command.matcher.type) {
    case 'regex': {
      const match = content.match(command.matcher.value);
      return match
        ? { matched: true, args: match.slice(1) }
        : { matched: false, args: [] };
    }
    case 'prefix':
      if (!content.startsWith(command.matcher.value)) {
        return { matched: false, args: [] };
      }
      return {
        matched: true,
        args: content
          .slice(command.matcher.value.length)
          .trim()
          .split(/\s+/)
          .filter(Boolean)
      };
    case 'exact':
      return content === command.matcher.value
        ? { matched: true, args: [] }
        : { matched: false, args: [] };
    case 'contains':
      if (!content.includes(command.matcher.value)) {
        return { matched: false, args: [] };
      }
      return {
        matched: true,
        args: content
          .split(command.matcher.value)
          .at(1)
          ?.trim()
          .split(/\s+/)
          .filter(Boolean) ?? []
      };
    default:
      return { matched: false, args: [] };
  }
}
