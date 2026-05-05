import { Agent as PiAgent } from '@mariozechner/pi-agent-core';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { RoleConfig, InboundMessage, OutboundMessage, SessionKey } from '@aesyclaw/core/types';
import { getMessageText, serializeSessionKey } from '@aesyclaw/core/types';
import type { Agent, AgentMessage } from './agent-types';
import type { ToolExecutionContext } from '@aesyclaw/tool/tool-registry';
import type { LlmAdapter } from './llm-adapter';
import type { PromptBuilder } from './prompt-builder';
import type { MemoryManager } from './memory-manager';
import { createScopedLogger } from '@aesyclaw/core/logger';

const logger = createScopedLogger('agent-engine');
const WORKER_PATH = fileURLToPath(new URL('./runner/agent-worker.ts', import.meta.url));

type RunAgentTurnResult = {
  newMessages: AgentMessage[];
  lastAssistant: string | null;
};

export class AgentEngine {
  private readonly activeWorkers = new Map<string, Worker>();

  constructor(
    private llmAdapter: LlmAdapter,
    private promptBuilder: PromptBuilder,
  ) {}

  createAgent(
    role: RoleConfig,
    sessionId: string,
    executionContext?: Partial<ToolExecutionContext>,
  ): Agent {
    const { prompt, tools } = this.promptBuilder.buildSystemPrompt(role, executionContext);
    const model = this.llmAdapter.resolveModel(role.model);

    const agent = new PiAgent({
      initialState: {
        systemPrompt: prompt,
        model,
        tools,
        messages: [],
      },
      streamFn: this.llmAdapter.createStreamFn(),
      getApiKey: this.llmAdapter.createGetApiKey(),
      sessionId,
    });

    logger.debug('Agent 已创建', {
      role: role.id,
      model: role.model,
      toolCount: tools.length,
    });

    return agent;
  }

  async runAgentTurn(
    role: RoleConfig,
    content: string,
    history: AgentMessage[],
    sessionKey: SessionKey,
    sendMessage?: (message: OutboundMessage) => Promise<boolean>,
  ): Promise<RunAgentTurnResult> {
    const executionContext: Partial<ToolExecutionContext> = {
      sessionKey,
      sendMessage,
      toolPermission: role.toolPermission,
    };

    const { prompt, tools } = this.promptBuilder.buildSystemPrompt(role, executionContext);
    const model = this.llmAdapter.resolveModel(role.model);

    const toolMap = new Map(tools.map((t) => [t.name, t]));
    const worker = new Worker(WORKER_PATH);
    const workerKey = this.getWorkerKey(sessionKey);
    const activeWorkers = this.activeWorkers;
    void this.activeWorkers.get(workerKey)?.terminate();
    this.activeWorkers.set(workerKey, worker);
    const timeout = setTimeout(() => void worker.terminate(), 120_000);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let onMessage: ((msg: any) => void) | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let onError: ((err: any) => void) | undefined;
    let onExit: ((code: number) => void) | undefined;
    let settled = false;

    try {
      const workerResult = await new Promise<RunAgentTurnResult>((resolve, reject) => {
        onError = (err: Error) => {
          settled = true;
          cleanup();
          reject(new Error(`Worker 错误: ${err.message}`));
        };
        onExit = (code: number) => {
          if (settled || code === 0) return;
          settled = true;
          cleanup();
          reject(new Error('Agent 处理已中止'));
        };
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        onMessage = async (msg: Record<string, unknown>) => {
          if (msg['type'] === 'done') {
            settled = true;
            cleanup();
            resolve({
              newMessages: msg['newMessages'] as AgentMessage[],
              lastAssistant: msg['lastAssistant'] as string | null,
            });
          } else if (msg['type'] === 'toolCall') {
            const tool = toolMap.get(msg['toolName'] as string);
            if (!tool) {
              worker.postMessage({
                type: 'toolResult',
                callId: msg['callId'],
                error: `工具 "${msg['toolName'] as string}" 未找到`,
              });
              return;
            }
            try {
              const result = await tool.execute(msg['toolCallId'] as string, msg['params']);
              worker.postMessage({ type: 'toolResult', callId: msg['callId'], result });
            } catch (err) {
              worker.postMessage({
                type: 'toolResult',
                callId: msg['callId'],
                error: err instanceof Error ? err.message : String(err),
              });
            }
          } else if (msg['type'] === 'fatal') {
            settled = true;
            cleanup();
            reject(new Error(msg['message'] as string));
          }
        };

        worker.on('message', onMessage);
        worker.on('error', onError);
        worker.on('exit', onExit);

        worker.postMessage({
          type: 'init',
          systemPrompt: prompt,
          model,
          apiKey: model.apiKey,
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
          history,
          content,
          extraBody: model.extraBody,
          sessionId: `worker:${role.id}:${Date.now()}`,
        });
      });

      return workerResult;
    } finally {
      cleanup();
    }

    function cleanup(): void {
      clearTimeout(timeout);
      if (onMessage) worker.off('message', onMessage);
      if (onError) worker.off('error', onError);
      if (onExit) worker.off('exit', onExit);
      if (activeWorkers.get(workerKey) === worker) {
        activeWorkers.delete(workerKey);
      }
      void worker.terminate();
    }
  }

  cancelRun(sessionKey: SessionKey): boolean {
    const workerKey = this.getWorkerKey(sessionKey);
    const worker = this.activeWorkers.get(workerKey);
    if (!worker) return false;
    this.activeWorkers.delete(workerKey);
    void worker.terminate();
    logger.info('Agent worker 已取消', { sessionKey });
    return true;
  }

  async process(
    message: InboundMessage,
    sessionKey: SessionKey,
    memory: MemoryManager,
    role: RoleConfig,
    sendMessage?: ToolExecutionContext['sendMessage'],
  ): Promise<OutboundMessage> {
    const content = getMessageText(message);

    logger.debug('正在处理消息', {
      sessionKey,
      role: role.id,
      contentLength: content.length,
    });

    const history = await this.loadHistoryForTurn(memory, role);
    const result = await this.runAgentTurn(role, content, history, sessionKey, sendMessage);
    await memory.syncFromAgent(result.newMessages);

    return this.toOutboundMessage(role.id, result);
  }

  async processEphemeral(
    sessionKey: SessionKey,
    memory: MemoryManager,
    role: RoleConfig,
    content: string,
  ): Promise<OutboundMessage> {
    const history = await memory.loadHistory();
    const ephemeralRole: RoleConfig = {
      ...role,
      toolPermission: { mode: 'allowlist', list: [] },
    };

    const result = await this.runAgentTurn(ephemeralRole, content, history, sessionKey);

    return this.toOutboundMessage(role.id, result);
  }

  switchModel(agent: Agent, modelIdentifier: string): void {
    const model = this.llmAdapter.resolveModel(modelIdentifier);
    agent.state.model = model;

    logger.info('模型已切换', {
      provider: model.provider,
      modelId: model.modelId,
    });
  }

  // ─── 私有方法 ───────────────────────────────────────────────────

  private toOutboundMessage(roleId: string, result: RunAgentTurnResult): OutboundMessage {
    if (result.lastAssistant) {
      return { components: [{ type: 'Plain', text: result.lastAssistant }] };
    }

    logger.warn('Agent 未生成助手文本回复', { role: roleId });
    return { components: [{ type: 'Plain', text: '[未生成回复]' }] };
  }

  private async loadHistoryForTurn(
    memory: MemoryManager,
    role: RoleConfig,
  ): Promise<AgentMessage[]> {
    let history = await memory.loadHistory();
    if (memory.shouldCompact(history)) {
      await memory.compact(this.llmAdapter, role.model);
      history = await memory.loadHistory();
    }
    return history;
  }

  private getWorkerKey(sessionKey: SessionKey): string {
    return serializeSessionKey(sessionKey);
  }
}
