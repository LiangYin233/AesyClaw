import type { ToolDefinition } from '../types.js';
import type { EventBus } from '../bus/EventBus.js';
import { logger } from '../logger/index.js';
import { CONSTANTS } from '../constants/index.js';

export type ToolSource = 'built-in' | 'plugin' | 'mcp';

export interface ToolSourceInfo {
  name: string;
  source: ToolSource;
  registeredAt: number;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, any>;
  execute: (params: Record<string, any>, context?: ToolContext) => Promise<string>;
  validate?: (params: Record<string, any>) => string[];
  timeout?: number;
  source?: ToolSource;
}

export interface ToolContext {
  workspace: string;
  eventBus?: EventBus;
  source?: 'user' | 'cron';
  signal?: AbortSignal;
  chatId?: string;
  messageType?: 'private' | 'group';
  channel?: string;
}

function createTimeoutError(toolName: string, timeout: number): Error {
  return new Error(`Tool execution timeout: ${toolName} (${timeout}ms)`);
}

function createAbortError(message: string): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function mergeAbortSignals(signals: Array<AbortSignal | undefined>): {
  signal?: AbortSignal;
  cleanup: () => void;
} {
  const activeSignals = signals.filter((signal): signal is AbortSignal => !!signal);
  if (activeSignals.length === 0) {
    return {
      signal: undefined,
      cleanup: () => {}
    };
  }

  const controller = new AbortController();
  const listeners: Array<{ signal: AbortSignal; listener: () => void }> = [];
  const abort = (signal: AbortSignal) => {
    if (!controller.signal.aborted) {
      const reason = signal.reason instanceof Error
        ? signal.reason
        : createAbortError(typeof signal.reason === 'string' ? signal.reason : 'Tool execution aborted');
      controller.abort(reason);
    }
  };

  for (const signal of activeSignals) {
    if (signal.aborted) {
      abort(signal);
      break;
    }
    const listener = () => abort(signal);
    listeners.push({ signal, listener });
    signal.addEventListener('abort', listener, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      for (const { signal, listener } of listeners) {
        signal.removeEventListener('abort', listener);
      }
    }
  };
}

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private toolSources: Map<string, ToolSourceInfo> = new Map();
  private blacklist: Set<string> = new Set();
  private log = logger.child({ prefix: 'ToolRegistry' });
  private defaultTimeout: number;

  constructor(options?: { defaultTimeout?: number }) {
    this.defaultTimeout = options?.defaultTimeout ?? CONSTANTS.TOOL_TIMEOUT;
  }

  register(tool: Tool, source: ToolSource = 'built-in'): void {
    const toolWithSource = { ...tool, source };
    this.tools.set(tool.name, toolWithSource);
    this.toolSources.set(tool.name, {
      name: tool.name,
      source,
      registeredAt: Date.now()
    });
  }

  unregister(name: string): void {
    this.tools.delete(name);
    this.toolSources.delete(name);
    this.log.debug(`Unregistered tool: ${name}`);
  }

  /**
   * 批量注销工具
   */
  unregisterMany(names: string[]): number {
    let count = 0;
    for (const name of names) {
      if (this.tools.has(name)) {
        this.unregister(name);
        count++;
      }
    }
    return count;
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getSource(name: string): ToolSourceInfo | undefined {
    return this.toolSources.get(name);
  }

  getBySource(source: ToolSource): Tool[] {
    return Array.from(this.tools.values()).filter(t => t.source === source);
  }

  getAllSources(): ToolSourceInfo[] {
    return Array.from(this.toolSources.values());
  }

  unregisterBySource(source: ToolSource): number {
    let count = 0;
    for (const [name, info] of this.toolSources.entries()) {
      if (info.source === source) {
        this.tools.delete(name);
        this.toolSources.delete(name);
        count++;
      }
    }
    if (count > 0) {
      this.log.debug(`Unregistered ${count} tools from source: ${source}`);
    }
    return count;
  }

  /**
   * 设置工具黑名单
   */
  setBlacklist(names: string[]): void {
    this.blacklist = new Set(names);
    this.log.debug(`Tool blacklist set: ${names.join(', ')}`);
  }

  /**
   * 获取当前黑名单
   */
  getBlacklist(): string[] {
    return Array.from(this.blacklist);
  }

  /**
   * 检查工具是否在黑名单中
   */
  isBlacklisted(name: string): boolean {
    return this.blacklist.has(name);
  }

  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values())
      .filter(tool => !this.blacklist.has(tool.name))
      .map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }));
  }

  /**
   * 获取所有工具列表
   */
  list(): Tool[] {
    return Array.from(this.tools.values());
  }

  async execute(name: string, params: Record<string, any>, context?: ToolContext): Promise<string> {
    const tool = this.tools.get(name);  // 根据名称获取工具
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }

    this.log.debug(`Executing tool: ${name}, source: ${tool.source}, params keys: ${Object.keys(params).join(', ')}`);

    if (tool.validate) {
      const errors = tool.validate(params);  // 验证参数
      if (errors.length > 0) {
        this.log.debug(`Tool ${name} validation failed: ${errors.join(', ')}`);
        throw new Error(`Validation errors: ${errors.join(', ')}`);
      }
    }

    const timeout = tool.timeout || this.defaultTimeout;  // 获取超时时间
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => {
      timeoutController.abort(createTimeoutError(tool.name, timeout));
      this.log.warn(`Tool ${name} execution timed out after ${timeout}ms`);
    }, timeout);

    const { signal: mergedSignal, cleanup: cleanupMergedSignal } = mergeAbortSignals([context?.signal, timeoutController.signal]);
    const execContext: ToolContext = {
      workspace: '',
      ...context,
      signal: mergedSignal
    };

    try {
      const result = await Promise.race([
        tool.execute(params, execContext),  // 执行工具
        new Promise<never>((_, reject) => {
          if (!mergedSignal) {
            return;
          }

          const onAbort = () => {
            const reason = mergedSignal.reason;
            if (reason instanceof Error) {
              reject(reason);
              return;
            }
            reject(createAbortError(typeof reason === 'string' ? reason : 'Tool execution aborted'));
          };

          if (mergedSignal.aborted) {
            onAbort();
            return;
          }

          mergedSignal.addEventListener('abort', onAbort, { once: true });
        })
      ]);
      clearTimeout(timeoutId);  // 清除超时计时器
      cleanupMergedSignal();
      return result;
    } catch (error) {
      clearTimeout(timeoutId);
      cleanupMergedSignal();
      if (error instanceof Error && error.name === 'AbortError') {
        throw error;
      }
      throw error;
    }
  }
}
