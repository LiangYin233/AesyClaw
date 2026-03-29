import { randomUUID } from 'crypto';
import type { ToolDefinition, Config } from '../../../types.js';
import type { LogLevel } from '../../../platform/observability/index.js';
import { createProvider } from '../../../platform/providers/index.js';
import { ToolLoopRunner } from '../execution/ToolLoopRunner.js';
import type { ToolContext, ToolRegistry } from '../../../platform/tools/ToolRegistry.js';
import type { BuiltInLogger } from '../../../platform/tools/builtins/shared.js';
import { registerAgentTools } from '../../../platform/tools/builtins/registerAgentTools.js';
import type { AgentRoleService } from '../../../platform/context/AgentContext.js';
import { ExecutionEngine } from '../execution/ExecutionEngine.js';
import { ExecutionRegistry } from '../execution/ExecutionRegistry.js';
import { WorkerExecutionDelegateImpl } from './WorkerExecutionDelegate.js';
import { tryParseModelRef } from '../../../platform/utils/modelRef.js';
import type {
  ParentToWorkerMessage,
  WorkerLlmActivityMessage,
  WorkerLifecycleMessage,
  WorkerLogMessage,
  WorkerToolActivityMessage,
  WorkerToolResponseMessage,
  WorkerToParentMessage
} from './protocol.js';
import { createWorkerLocalToolRegistry } from '../../../app/assembly/createWorkerLocalToolRegistry.js';
import { createWorkerLoggedProvider } from './workerLogging.js';

const SUB_AGENT_EXCLUDED_TOOLS = ['send_msg_to_user', 'call_agent', 'call_temp_agent'];

function resolveProviderSelection(
  config: { providers: Config['providers'] },
  providerNameOrModelRef?: string,
  modelName?: string
): { name: string; model: string; providerConfig: Config['providers'][string] | undefined; modelConfig: Config['providers'][string]['models'][string] | undefined } {
  let name = (providerNameOrModelRef || '').trim();
  let resolvedModel = modelName?.trim() || '';

  if (!resolvedModel && name.includes('/')) {
    const parsed = tryParseModelRef(name);
    if (parsed) {
      name = parsed.providerName;
      resolvedModel = parsed.modelName;
    }
  }

  const providerConfig = config.providers[name];
  return {
    name,
    model: resolvedModel,
    providerConfig,
    modelConfig: providerConfig?.models?.[resolvedModel]
  };
}

function createAgentRoleServiceImpl(
  getConfig: () => Config,
  updateConfig: (mutator: (config: Config) => void | Config | Promise<void | Config>) => Promise<Config>,
  toolRegistry: Pick<ToolRegistry, 'getDefinitions'>,
  skillManager?: unknown
): AgentRoleService {
  const { AgentRoleServiceImpl } = require('../../../features/agents/infrastructure/AgentRoleService.js');
  return new AgentRoleServiceImpl(getConfig, updateConfig, toolRegistry, skillManager);
}

/**
 * worker 内部的轻量工具注册表。
 * 优先本地执行，可用时完全绕开父进程；命不中时再桥接回宿主。
 */
class WorkerToolRegistry {
  private pending = new Map<string, { resolve: (value: string) => void; reject: (error: Error) => void }>();

  constructor(
    private readonly sendMessage: (message: WorkerToParentMessage) => void,
    private readonly definitions: Extract<ParentToWorkerMessage, { type: 'start_execution' }>['policy']['toolDefinitions'],
    private readonly availableDefinitions: ToolDefinition[],
    private readonly localRegistry: {
      get(name: string): unknown;
      execute(name: string, params: Record<string, unknown>, context?: ToolContext): Promise<string>;
    },
    private readonly pluginManager?: {
      runToolBeforeHooks(input: { toolName: string; params: Record<string, unknown>; context?: ToolContext }): Promise<{ params: Record<string, unknown>; context?: ToolContext }>;
      runToolAfterHooks(input: { toolName: string; params: Record<string, unknown>; result: string; context?: ToolContext }): Promise<{ result: string }>;
    },
    private readonly reportLog?: (level: LogLevel, message: string, fields?: Record<string, unknown>) => void
  ) {}

  getDefinitions() {
    return this.definitions;
  }

  getAvailableDefinitions() {
    return this.availableDefinitions;
  }

  async execute(name: string, params: Record<string, unknown>, context?: ToolContext): Promise<string> {
    if (this.localRegistry.get(name)) {
      this.reportLog?.('debug', 'worker 工具命中本地执行', {
        sessionKey: context?.sessionKey,
        agentName: context?.agentName,
        toolName: name,
        mode: 'local'
      });
      emitWorkerToolActivity({
        sessionKey: context?.sessionKey || activeSessionKey,
        executionId: activeExecutionId,
        toolName: name,
        toolMode: 'local',
        active: true
      });
      try {
        return await this.executeLocal(name, params, context);
      } finally {
        emitWorkerToolActivity({
          sessionKey: context?.sessionKey || activeSessionKey,
          executionId: activeExecutionId,
          active: false
        });
      }
    }

    this.reportLog?.('debug', 'worker 工具回退父进程桥接', {
      sessionKey: context?.sessionKey,
      agentName: context?.agentName,
      toolName: name,
      mode: 'bridge'
    });
    const requestId = randomUUID();
    const { signal: _signal, ...serializableContext } = context || { workspace: '' };
    return await new Promise((resolve, reject) => {
      // 桥接消息只传可序列化上下文，AbortSignal 仍由父子进程各自维护。
      emitWorkerToolActivity({
        sessionKey: context?.sessionKey || activeSessionKey,
        executionId: activeExecutionId,
        toolName: name,
        toolMode: 'bridge',
        active: true
      });
      this.pending.set(requestId, { resolve, reject });
      this.sendMessage({
        type: 'tool_request',
        executionId: activeExecutionId,
        requestId,
        toolName: name,
        params,
        context: serializableContext
      });
    });
  }

  private async executeLocal(name: string, params: Record<string, unknown>, context?: ToolContext): Promise<string> {
    let nextParams = params;
    let nextContext = context;

    if (this.pluginManager) {
      const payload = await this.pluginManager.runToolBeforeHooks({
        toolName: name,
        params: nextParams,
        context: nextContext || { workspace: '' }
      });
      nextParams = payload.params;
      nextContext = payload.context ?? nextContext;
    }

    let result = await this.localRegistry.execute(name, nextParams, nextContext);

    if (this.pluginManager) {
      const payload = await this.pluginManager.runToolAfterHooks({
        toolName: name,
        params: nextParams,
        result,
        context: nextContext || { workspace: '' }
      });
      result = payload.result;
    }

    return result;
  }

  resolve(response: WorkerToolResponseMessage): void {
    const pending = this.pending.get(response.requestId);
    if (!pending) {
      return;
    }
    this.pending.delete(response.requestId);
    emitWorkerToolActivity({
      sessionKey: activeSessionKey,
      executionId: response.executionId,
      active: false
    });
    if (response.ok) {
      pending.resolve(response.result || '');
      return;
    }
    pending.reject(new Error(response.error || 'Unknown bridged tool error'));
  }

  rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
    if (activeExecutionId) {
      emitWorkerToolActivity({
        sessionKey: activeSessionKey,
        executionId: activeExecutionId,
        active: false
      });
    }
  }
}

let activeExecutionId = '';
let activeSessionKey = '';
let abortController: AbortController | undefined;
let activeRegistry: WorkerToolRegistry | undefined;

function sendToParent(message: WorkerToParentMessage): void {
  if (typeof process.send === 'function') {
    process.send(message);
  }
}

function emitWorkerLog(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
  const payload: WorkerLogMessage = {
    type: 'log_event',
    executionId: activeExecutionId,
    level,
    scope: 'WorkerExecution',
    message,
    fields
  };
  sendToParent(payload);
}

function emitWorkerLifecycle(input: Omit<WorkerLifecycleMessage, 'type' | 'timestamp'>): void {
  sendToParent({
    type: 'worker_lifecycle',
    ...input,
    timestamp: new Date().toISOString()
  });
}

function emitWorkerToolActivity(input: Omit<WorkerToolActivityMessage, 'type' | 'timestamp'>): void {
  sendToParent({
    type: 'worker_tool_activity',
    ...input,
    timestamp: new Date().toISOString()
  });
}

function emitWorkerLlmActivity(input: Omit<WorkerLlmActivityMessage, 'type' | 'timestamp'>): void {
  sendToParent({
    type: 'worker_llm_activity',
    ...input,
    timestamp: new Date().toISOString()
  });
}

function createBuiltInLogger(baseFields: Record<string, unknown>): BuiltInLogger {
  return {
    debug: (message, fields) => emitWorkerLog('debug', message, { ...baseFields, ...(fields || {}) }),
    info: (message, fields) => emitWorkerLog('info', message, { ...baseFields, ...(fields || {}) }),
    warn: (message, fields) => emitWorkerLog('warn', message, { ...baseFields, ...(fields || {}) }),
    error: (message, fields) => emitWorkerLog('error', message, { ...baseFields, ...(fields || {}) })
  };
}

function createWorkerExecutionRegistry(
  registry: WorkerToolRegistry,
  availableToolDefinitions: ToolDefinition[]
): Pick<ToolRegistry, 'getDefinitions' | 'execute'> {
  return {
    getDefinitions: () => availableToolDefinitions,
    execute: (name, params, context) => registry.execute(name, params, context)
  };
}

async function runWorkerSubAgentTask(
  executionEngine: ExecutionEngine,
  delegate: WorkerExecutionDelegateImpl,
  agentName: string,
  task: string,
  toolContext: ToolContext
): Promise<string> {
  // 子 Agent 在 worker 内直接派生新的 nested worker，不再回主进程编排。
  const prepared = executionEngine.prepareSubAgentExecution(
    agentName,
    task,
    toolContext,
    {
      excludeTools: SUB_AGENT_EXCLUDED_TOOLS
    }
  );

  let childExecutionId: string | undefined;
  let childPid: number | null | undefined;
  try {
    const result = await delegate.executeToolLoop({
      policy: prepared.policy,
      messages: prepared.messages,
      toolContext: prepared.toolContext,
      onSpawn: (meta) => {
        childExecutionId = meta.executionId;
        childPid = meta.childPid;
        emitWorkerLifecycle({
          sessionKey: toolContext.sessionKey || '',
          executionId: childExecutionId,
          parentExecutionId: activeExecutionId,
          kind: 'sub-agent',
          event: 'spawned',
          agentName,
          model: prepared.policy.model,
          childPid,
          channel: toolContext.channel,
          chatId: toolContext.chatId
        });
        emitWorkerLog('info', '准备派生子 Agent', {
          sessionKey: toolContext.sessionKey,
          agentName,
          mode: 'nested-worker',
          childExecutionId,
          childPid
        });
      },
      options: {
        sessionKey: toolContext.sessionKey,
        allowTools: true,
        source: 'user',
        signal: toolContext.signal
      }
    });

    emitWorkerLog('info', '子 Agent 执行完成', {
      sessionKey: toolContext.sessionKey,
      agentName,
      mode: 'nested-worker',
      childExecutionId,
      childPid
    });
    if (childExecutionId) {
      emitWorkerLifecycle({
        sessionKey: toolContext.sessionKey || '',
        executionId: childExecutionId,
        parentExecutionId: activeExecutionId,
        kind: 'sub-agent',
        event: 'completed',
        agentName,
        model: prepared.policy.model,
        childPid,
        channel: toolContext.channel,
        chatId: toolContext.chatId
      });
    }
    return result.content;
  } catch (error) {
    emitWorkerLog('warn', '子 Agent 执行失败', {
      sessionKey: toolContext.sessionKey,
      agentName,
      mode: 'nested-worker',
      childExecutionId,
      childPid,
      error: error instanceof Error ? error.message : String(error)
    });
    if (childExecutionId) {
      emitWorkerLifecycle({
        sessionKey: toolContext.sessionKey || '',
        executionId: childExecutionId,
        parentExecutionId: activeExecutionId,
        kind: 'sub-agent',
        event: 'failed',
        agentName,
        model: prepared.policy.model,
        childPid,
        channel: toolContext.channel,
        chatId: toolContext.chatId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    throw error;
  }
}

async function runWorkerTemporarySubAgentTask(
  executionEngine: ExecutionEngine,
  delegate: WorkerExecutionDelegateImpl,
  baseAgentName: string | undefined,
  task: string,
  systemPrompt: string,
  toolContext: ToolContext
): Promise<string> {
  // 临时 Agent 与子 Agent 共用同一条执行模型，只是角色来源不同。
  const prepared = executionEngine.prepareTemporarySubAgentExecution(
    baseAgentName,
    task,
    systemPrompt,
    toolContext,
    {
      excludeTools: SUB_AGENT_EXCLUDED_TOOLS
    }
  );

  let childExecutionId: string | undefined;
  let childPid: number | null | undefined;
  try {
    const result = await delegate.executeToolLoop({
      policy: prepared.policy,
      messages: prepared.messages,
      toolContext: prepared.toolContext,
      onSpawn: (meta) => {
        childExecutionId = meta.executionId;
        childPid = meta.childPid;
        emitWorkerLifecycle({
          sessionKey: toolContext.sessionKey || '',
          executionId: childExecutionId,
          parentExecutionId: activeExecutionId,
          kind: 'temp-agent',
          event: 'spawned',
          agentName: baseAgentName,
          model: prepared.policy.model,
          childPid,
          channel: toolContext.channel,
          chatId: toolContext.chatId
        });
        emitWorkerLog('info', '准备派生临时 Agent', {
          sessionKey: toolContext.sessionKey,
          agentName: baseAgentName,
          mode: 'nested-worker',
          childExecutionId,
          childPid
        });
      },
      options: {
        sessionKey: toolContext.sessionKey,
        allowTools: true,
        source: 'user',
        signal: toolContext.signal
      }
    });

    emitWorkerLog('info', '临时 Agent 执行完成', {
      sessionKey: toolContext.sessionKey,
      agentName: baseAgentName,
      mode: 'nested-worker',
      childExecutionId,
      childPid
    });
    if (childExecutionId) {
      emitWorkerLifecycle({
        sessionKey: toolContext.sessionKey || '',
        executionId: childExecutionId,
        parentExecutionId: activeExecutionId,
        kind: 'temp-agent',
        event: 'completed',
        agentName: baseAgentName,
        model: prepared.policy.model,
        childPid,
        channel: toolContext.channel,
        chatId: toolContext.chatId
      });
    }
    return result.content;
  } catch (error) {
    emitWorkerLog('warn', '临时 Agent 执行失败', {
      sessionKey: toolContext.sessionKey,
      agentName: baseAgentName,
      mode: 'nested-worker',
      childExecutionId,
      childPid,
      error: error instanceof Error ? error.message : String(error)
    });
    if (childExecutionId) {
      emitWorkerLifecycle({
        sessionKey: toolContext.sessionKey || '',
        executionId: childExecutionId,
        parentExecutionId: activeExecutionId,
        kind: 'temp-agent',
        event: 'failed',
        agentName: baseAgentName,
        model: prepared.policy.model,
        childPid,
        channel: toolContext.channel,
        chatId: toolContext.chatId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    throw error;
  }
}

async function runWorkerTemporarySubAgentTasks(
  executionEngine: ExecutionEngine,
  delegate: WorkerExecutionDelegateImpl,
  baseAgentName: string | undefined,
  tasks: Array<{ task: string; systemPrompt: string }>,
  toolContext: ToolContext
): Promise<Array<{ task: string; success: boolean; result?: string; error?: string }>> {
  return await Promise.all(tasks.map(async ({ task, systemPrompt }) => {
    try {
      const result = await runWorkerTemporarySubAgentTask(
        executionEngine,
        delegate,
        baseAgentName,
        task,
        systemPrompt,
        toolContext
      );

      return {
        task,
        success: true,
        result
      };
    } catch (error) {
      return {
        task,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }));
}

async function startExecution(message: Extract<ParentToWorkerMessage, { type: 'start_execution' }>): Promise<void> {
  activeExecutionId = message.executionId;
  activeSessionKey = message.options?.sessionKey || message.toolContext.sessionKey || message.executionId;
  abortController = new AbortController();
  emitWorkerLog('info', 'worker 开始执行', {
    sessionKey: activeSessionKey,
    agentName: message.policy.roleName,
    model: message.policy.model,
    childPid: process.pid,
    mode: 'worker'
  });
  emitWorkerLifecycle({
    sessionKey: activeSessionKey,
    executionId: message.executionId,
    kind: 'root',
    event: 'started',
    agentName: message.policy.roleName,
    model: message.policy.model,
    childPid: process.pid,
    channel: message.toolContext.channel,
    chatId: message.toolContext.chatId
  });

  const configuredRoleModel = message.config.agents?.roles?.[message.policy.roleName]?.model?.trim();
  const resolved = resolveProviderSelection(message.config, configuredRoleModel || message.policy.model);
  if (!resolved.providerConfig) {
    throw new Error(`Provider config not found for model ${message.policy.model}`);
  }

  const provider = createWorkerLoggedProvider(
    createProvider(resolved.name, resolved.providerConfig),
    {
      sessionKey: activeSessionKey,
      executionId: activeExecutionId,
      agentName: message.policy.roleName,
      model: message.policy.model,
      childPid: process.pid
    },
    emitWorkerLog,
    (activity) => {
      emitWorkerLlmActivity({
        ...activity,
        sessionKey: activity.sessionKey || activeSessionKey
      });
    }
  );
  const localRuntime = await createWorkerLocalToolRegistry(message.config, message.toolContext.workspace);
  activeRegistry = new WorkerToolRegistry(
    sendToParent,
    message.policy.toolDefinitions,
    message.policy.availableToolDefinitions,
    localRuntime.toolRegistry,
    localRuntime.pluginManager,
    emitWorkerLog
  );
  emitWorkerLog('info', 'worker 本地运行时初始化完成', {
    sessionKey: activeSessionKey,
    agentName: message.policy.roleName,
    childPid: process.pid,
    mode: 'worker'
  });
  if (localRuntime.pluginManager) {
      emitWorkerLog('debug', 'worker 本地插件 hooks 已启用', {
      sessionKey: activeSessionKey,
      agentName: message.policy.roleName,
      childPid: process.pid,
      mode: 'worker'
    });
  }
if (message.config.agent?.defaults && message.config.agents?.roles) {
    // 只有本地具备 agent 角色与默认配置时，worker 才能独立完成嵌套编排。
    const executionToolRegistry = createWorkerExecutionRegistry(activeRegistry, message.policy.availableToolDefinitions);
    const agentRoleService = createAgentRoleServiceImpl(
      () => message.config,
      async () => message.config,
      {
        getDefinitions: () => message.policy.availableToolDefinitions
      } as never,
      localRuntime.skillManager
    );
    const nestedExecutionDelegate = new WorkerExecutionDelegateImpl({
      getConfig: () => message.config,
      toolRegistry: executionToolRegistry as ToolRegistry,
      getPluginManager: () => undefined,
      getAvailableToolDefinitions: () => message.policy.availableToolDefinitions,
      onToolActivity: (toolMessage) => {
        emitWorkerToolActivity(toolMessage);
      },
      onLlmActivity: (llmMessage) => {
        emitWorkerLlmActivity(llmMessage);
      },
      onLifecycle: (lifecycleMessage) => {
        sendToParent(lifecycleMessage);
      },
      onLogEvent: (logMessage) => {
        sendToParent(logMessage);
      }
    });
    const executionEngine = new ExecutionEngine({
      defaultSystemPrompt: message.policy.systemPrompt,
      maxIterations: message.config.agent.defaults.maxToolIterations,
      memoryWindow: message.config.agent.defaults.memoryWindow,
      toolRegistry: executionToolRegistry as ToolRegistry,
      workspace: message.toolContext.workspace?.trim() || process.cwd(),
      getPluginManager: () => undefined,
      executionRegistry: new ExecutionRegistry()
    }, agentRoleService);
    registerAgentTools({
      toolRegistry: localRuntime.toolRegistry,
      // `call_agent` 与 `call_temp_agent` 最终都在这里并发派生 nested worker。
      runSubAgentTasks: async (tasks, context) => Promise.all(tasks.map(async ({ agentName, task }) => {
        try {
          const result = await runWorkerSubAgentTask(
            executionEngine,
            nestedExecutionDelegate,
            agentName,
            task,
            {
              workspace: message.toolContext.workspace?.trim() || process.cwd(),
              channel: context?.channel,
              chatId: context?.chatId,
              messageType: context?.messageType,
              sessionKey: activeSessionKey,
              signal: context?.signal ?? abortController?.signal,
              source: 'user'
            }
          );

          return {
            agentName,
            task,
            success: true,
            result
          };
        } catch (error) {
          return {
            agentName,
            task,
            success: false,
            error: error instanceof Error ? error.message : String(error)
          };
        }
      })),
      runTemporarySubAgentTasks: async (baseAgentName, tasks, context) => runWorkerTemporarySubAgentTasks(
        executionEngine,
        nestedExecutionDelegate,
        baseAgentName,
        tasks,
        {
          workspace: message.toolContext.workspace?.trim() || process.cwd(),
          channel: context?.channel,
          chatId: context?.chatId,
          messageType: context?.messageType,
          sessionKey: activeSessionKey,
          signal: context?.signal ?? abortController?.signal,
          source: 'user'
        }
      ),
      agentRoleService,
      log: createBuiltInLogger({
        sessionKey: activeSessionKey,
        childPid: process.pid
      })
    });
  } else {
    emitWorkerLog('warn', 'worker 未启用本地 Agent 编排，保留桥接路径', {
      sessionKey: activeSessionKey,
      agentName: message.policy.roleName,
      childPid: process.pid,
      mode: 'bridge'
    });
  }

  const runner = new ToolLoopRunner(
    provider,
    activeRegistry as never,
    undefined,
    message.policy.maxContextTokens
  );

  const result = await runner.run(
    message.messages,
    {
      ...message.toolContext,
      signal: abortController.signal
    },
    {
      model: message.policy.model,
      allowTools: message.options?.allowTools ?? true,
      maxIterations: message.options?.maxIterations ?? message.policy.maxIterations,
      source: message.options?.source,
      initialToolCalls: message.options?.initialToolCalls,
      signal: abortController.signal
    }
  );

  emitWorkerLog('info', '主 worker 执行完成', {
    sessionKey: activeSessionKey,
    agentName: message.policy.roleName,
    childPid: process.pid,
    mode: 'worker',
    agentMode: result.agentMode,
    toolsUsed: result.toolsUsed.length
  });
  emitWorkerLifecycle({
    sessionKey: activeSessionKey,
    executionId: message.executionId,
    kind: 'root',
    event: 'completed',
    agentName: message.policy.roleName,
    model: message.policy.model,
    childPid: process.pid,
    channel: message.toolContext.channel,
    chatId: message.toolContext.chatId
  });

  sendToParent({
    type: 'final_result',
    executionId: message.executionId,
    result
  });
}

process.on('message', async (message: ParentToWorkerMessage) => {
  try {
    if (message.type === 'start_execution') {
      await startExecution(message);
      return;
    }

    if (message.type === 'tool_response') {
      activeRegistry?.resolve(message);
      return;
    }

    if (message.type === 'abort_execution') {
      // worker 内只处理中止当前执行，不负责决定更高层 session 路由。
      emitWorkerLog('warn', 'worker 收到中止指令', {
        mode: 'worker'
      });
      emitWorkerLifecycle({
        sessionKey: activeSessionKey,
        executionId: message.executionId,
        kind: 'root',
        event: 'aborting',
        childPid: process.pid
      });
      abortController?.abort(new Error(`Execution aborted: ${message.executionId}`));
    }
  } catch (error) {
    emitWorkerLog('error', 'worker 执行失败', {
      mode: 'worker',
      error
    });
    if (activeExecutionId) {
      emitWorkerLifecycle({
        sessionKey: activeSessionKey,
        executionId: activeExecutionId || (message.type === 'abort_execution' ? message.executionId : ''),
        kind: 'root',
        event: 'failed',
        childPid: process.pid,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    activeRegistry?.rejectAll(error instanceof Error ? error : new Error(String(error)));
    sendToParent({
      type: 'execution_error',
      executionId: activeExecutionId || (message.type === 'abort_execution' ? message.executionId : ''),
      error: error instanceof Error ? error.message : String(error)
    });
  }
});
