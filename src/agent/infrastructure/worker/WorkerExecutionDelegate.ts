import { randomUUID } from 'crypto';
import { spawn, type ChildProcess } from 'child_process';
import { dirname, extname, join } from 'path';
import { fileURLToPath } from 'url';
import type { Config } from '../../../types.js';
import type { PluginManager } from '../../../features/plugins/index.js';
import type { ToolContext, ToolRegistry } from '../../../platform/tools/ToolRegistry.js';
import type { ToolDefinition } from '../../../types.js';
import { logger } from '../../../platform/observability/index.js';
import type { ExecutionPolicy } from '../execution/ExecutionTypes.js';
import type {
  AbortWorkerExecutionMessage,
  ParentToWorkerMessage,
  StartWorkerExecutionMessage,
  WorkerLogMessage,
  WorkerToParentMessage,
  WorkerToolRequestMessage,
  WorkerToolResponseMessage,
  WorkerPolicySnapshot
} from './protocol.js';

function resolveWorkerEntryPath(): string {
  const currentFile = fileURLToPath(import.meta.url);
  return join(dirname(currentFile), `worker-entry${extname(currentFile)}`);
}

function getWorkerExecArgs(workerEntryPath: string): string[] {
  const extension = extname(workerEntryPath).toLowerCase();
  const needsTsxLoader = extension === '.ts' || extension === '.mts' || extension === '.cts';

  return needsTsxLoader
    ? ['--import', 'tsx', workerEntryPath]
    : [workerEntryPath];
}

function createPolicySnapshot(policy: ExecutionPolicy): WorkerPolicySnapshot {
  return {
    roleName: policy.roleName,
    model: policy.model,
    systemPrompt: policy.systemPrompt,
    skillsPrompt: policy.skillsPrompt,
    maxIterations: policy.maxIterations,
    maxContextTokens: policy.maxContextTokens,
    toolDefinitions: policy.toolRegistryView.getDefinitions(),
    availableToolDefinitions: policy.toolRegistryView.getDefinitions()
  };
}

export interface WorkerExecutionDelegate {
  executeToolLoop(input: {
    policy: ExecutionPolicy;
    messages: StartWorkerExecutionMessage['messages'];
    toolContext: ToolContext;
    onSpawn?: (meta: { executionId: string; childPid: number | null }) => void;
    options?: {
      sessionKey?: string;
      allowTools?: boolean;
      source?: 'user' | 'cron';
      initialToolCalls?: NonNullable<StartWorkerExecutionMessage['options']>['initialToolCalls'];
      signal?: AbortSignal;
    };
  }): Promise<{
    content: string;
    reasoning_content?: string;
    toolsUsed: string[];
    agentMode: boolean;
    executionId?: string;
    childPid?: number | null;
  }>;
  abort(sessionKey: string): void;
}

export class WorkerExecutionDelegateImpl implements WorkerExecutionDelegate {
  private readonly log = logger.child('WorkerBackgroundExecution');
  private readonly workerEntryPath = resolveWorkerEntryPath();
  private readonly activeWorkers = new Map<string, Set<ChildProcess>>();

  constructor(private readonly args: {
    getConfig: () => Config;
    toolRegistry: ToolRegistry;
    getPluginManager: () => PluginManager | undefined;
    getAvailableToolDefinitions?: () => ToolDefinition[];
  }) {}

  async executeToolLoop(input: {
    policy: ExecutionPolicy;
    messages: StartWorkerExecutionMessage['messages'];
    toolContext: ToolContext;
    onSpawn?: (meta: { executionId: string; childPid: number | null }) => void;
    options?: {
      sessionKey?: string;
      allowTools?: boolean;
      source?: 'user' | 'cron';
      initialToolCalls?: NonNullable<StartWorkerExecutionMessage['options']>['initialToolCalls'];
      signal?: AbortSignal;
    };
  }): Promise<{
    content: string;
    reasoning_content?: string;
    toolsUsed: string[];
    agentMode: boolean;
    executionId?: string;
    childPid?: number | null;
  }> {
    const executionId = randomUUID();
    const sessionKey = input.options?.sessionKey || executionId;
    const baseLogFields = {
      sessionKey,
      executionId,
      agentName: input.policy.roleName,
      model: input.policy.model,
      mode: 'worker'
    } as const;
    const child = spawn(process.execPath, getWorkerExecArgs(this.workerEntryPath), {
      env: process.env,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc']
    });
    child.unref();
    child.channel?.unref?.();

    this.trackWorker(sessionKey, child);
    this.log.info('已启动后台 worker 执行', {
      ...baseLogFields,
      childPid: child.pid ?? null
    });
    input.onSpawn?.({
      executionId,
      childPid: child.pid ?? null
    });

    return await new Promise((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        this.untrackWorker(sessionKey, child);
        input.options?.signal?.removeEventListener('abort', handleAbort);
      };

      const handleAbort = () => {
        this.log.warn('收到 worker 中止请求，准备结束当前执行', {
          ...baseLogFields,
          childPid: child.pid ?? null
        });
        const abortMessage: AbortWorkerExecutionMessage = {
          type: 'abort_execution',
          executionId
        };
        child.send(abortMessage);
        child.kill();
      };

      input.options?.signal?.addEventListener('abort', handleAbort, { once: true });

      child.on('message', async (message: WorkerToParentMessage) => {
        if (settled) {
          return;
        }

        try {
          if (message.type === 'log_event') {
            this.forwardWorkerLog(message, {
              ...baseLogFields,
              childPid: child.pid ?? null
            });
            return;
          }

          if (message.type === 'tool_request') {
            await this.handleToolRequest(child, message);
            return;
          }

          if (message.type === 'final_result') {
            settled = true;
            cleanup();
            this.closeChild(child);
            this.log.info('子 worker 已返回结果', {
              ...baseLogFields,
              childPid: child.pid ?? null,
              toolsUsed: message.result.toolsUsed.length,
              agentMode: message.result.agentMode
            });
            resolve({
              ...message.result,
              executionId,
              childPid: child.pid ?? null
            });
            return;
          }

          if (message.type === 'execution_error') {
            settled = true;
            cleanup();
            this.closeChild(child);
            this.log.warn('子 worker 执行失败', {
              ...baseLogFields,
              childPid: child.pid ?? null,
              error: message.error
            });
            reject(new Error(message.error));
          }
        } catch (error) {
          settled = true;
          cleanup();
          this.closeChild(child);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });

      child.once('error', (error) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        this.closeChild(child);
        this.log.warn('后台 worker 启动失败', {
          ...baseLogFields,
          childPid: child.pid ?? null,
          error
        });
        reject(error);
      });

      child.once('exit', (code, signal) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        this.closeChild(child);
        this.log.warn('子 worker 提前退出', {
          ...baseLogFields,
          childPid: child.pid ?? null,
          code: code ?? null,
          signal: signal ?? null
        });
        reject(new Error(`Worker exited before completion (code=${code ?? 'null'}, signal=${signal ?? 'null'})`));
      });

      const startMessage: ParentToWorkerMessage = {
        type: 'start_execution',
        executionId,
        config: this.args.getConfig(),
        policy: {
          ...createPolicySnapshot(input.policy),
          availableToolDefinitions: this.args.getAvailableToolDefinitions?.()
            ?? this.args.toolRegistry.getDefinitions()
        },
        messages: input.messages,
        toolContext: input.toolContext,
        options: {
          sessionKey: input.options?.sessionKey,
          allowTools: input.options?.allowTools,
          source: input.options?.source,
          initialToolCalls: input.options?.initialToolCalls
        }
      };

      child.send(startMessage);
    });
  }

  abort(sessionKey: string): void {
    const workers = this.activeWorkers.get(sessionKey);
    if (!workers || workers.size === 0) {
      return;
    }

    this.log.warn('收到会话级 worker 中止请求', {
      sessionKey,
      mode: 'worker',
      workerCount: workers.size
    });

    for (const child of workers) {
      child.kill();
    }

    this.activeWorkers.delete(sessionKey);
  }

  private async handleToolRequest(child: ChildProcess, message: WorkerToolRequestMessage): Promise<void> {
    let toolArgs = message.params;
    let toolContext: ToolContext = message.context;
    const pluginManager = this.args.getPluginManager();

    if (pluginManager) {
      const nextPayload = await pluginManager.runToolBeforeHooks({
        toolName: message.toolName,
        params: toolArgs,
        context: toolContext
      });
      toolArgs = nextPayload.params;
      toolContext = nextPayload.context ?? toolContext;
    }

    try {
      this.log.info('回退到父进程桥接工具执行', {
        sessionKey: toolContext.sessionKey,
        executionId: message.executionId,
        agentName: toolContext.agentName,
        toolName: message.toolName,
        mode: 'bridge',
        childPid: child.pid ?? null
      });
      let result = await this.args.toolRegistry.execute(message.toolName, toolArgs as Record<string, any>, toolContext);

      if (pluginManager) {
        const nextPayload = await pluginManager.runToolAfterHooks({
          toolName: message.toolName,
          params: toolArgs,
          result,
          context: toolContext
        });
        result = nextPayload.result;
      }

      const response: WorkerToolResponseMessage = {
        type: 'tool_response',
        executionId: message.executionId,
        requestId: message.requestId,
        ok: true,
        result
      };
      child.send(response);
    } catch (error) {
      const response: WorkerToolResponseMessage = {
        type: 'tool_response',
        executionId: message.executionId,
        requestId: message.requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
      child.send(response);
      this.log.warn('父进程桥接工具执行失败', {
        sessionKey: toolContext.sessionKey,
        executionId: message.executionId,
        agentName: toolContext.agentName,
        toolName: message.toolName,
        mode: 'bridge',
        childPid: child.pid ?? null,
        error
      });
    }
  }

  private forwardWorkerLog(message: WorkerLogMessage, inheritedFields: Record<string, unknown>): void {
    const target = logger.child(message.scope).withFields({
      ...inheritedFields,
      ...(message.fields || {})
    });

    if (message.level === 'debug') {
      target.debug(message.message);
      return;
    }

    if (message.level === 'warn') {
      target.warn(message.message);
      return;
    }

    if (message.level === 'error') {
      target.error(message.message);
      return;
    }

    target.info(message.message);
  }

  private trackWorker(sessionKey: string, child: ChildProcess): void {
    const workers = this.activeWorkers.get(sessionKey) ?? new Set<ChildProcess>();
    workers.add(child);
    this.activeWorkers.set(sessionKey, workers);
  }

  private untrackWorker(sessionKey: string, child: ChildProcess): void {
    const workers = this.activeWorkers.get(sessionKey);
    if (!workers) {
      return;
    }

    workers.delete(child);
    if (workers.size === 0) {
      this.activeWorkers.delete(sessionKey);
    }
  }

  private closeChild(child: ChildProcess): void {
    child.channel?.unref?.();
    if (child.connected) {
      child.disconnect();
    }
    if (!child.killed) {
      child.kill();
    }
  }
}
