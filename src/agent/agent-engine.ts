import { Agent as PiAgent } from '@mariozechner/pi-agent-core';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { RoleConfig, InboundMessage, OutboundMessage, SessionKey } from '@aesyclaw/core/types';
import { getMessageText } from '@aesyclaw/core/types';
import type { Agent, AgentMessage } from './agent-types';
import type { ToolExecutionContext } from '@aesyclaw/tool/tool-registry';
import type { LlmAdapter } from './llm-adapter';
import type { PromptBuilder } from './prompt-builder';
import type { MemoryManager } from './memory-manager';
import { createScopedLogger } from '@aesyclaw/core/logger';
import { requireInitialized } from '@aesyclaw/core/utils';

const logger = createScopedLogger('agent-engine');
const WORKER_PATH = fileURLToPath(new URL('./runner/agent-worker.ts', import.meta.url));

export type AgentEngineDependencies = {
  llmAdapter: LlmAdapter;
  promptBuilder: PromptBuilder;
};

type RunAgentTurnResult = {
  newMessages: AgentMessage[];
  lastAssistant: string | null;
};

export class AgentEngine {
  private deps: AgentEngineDependencies | null = null;

  async initialize(deps: AgentEngineDependencies): Promise<void> {
    if (this.deps) {
      logger.warn('AgentEngine 已初始化 — 跳过');
      return;
    }
    this.deps = deps;
    logger.info('AgentEngine 已初始化');
  }

  destroy(): void {
    this.deps = null;
  }

  private requireDeps(): AgentEngineDependencies {
    return requireInitialized(this.deps, 'AgentEngine');
  }

  createAgent(
    role: RoleConfig,
    sessionId: string,
    executionContext?: Partial<ToolExecutionContext>,
  ): Agent {
    const deps = this.requireDeps();

    const { prompt, tools } = deps.promptBuilder.buildSystemPrompt(role, executionContext);
    const model = deps.llmAdapter.resolveModel(role.model);

    const agent = new PiAgent({
      initialState: {
        systemPrompt: prompt,
        model,
        tools,
        messages: [],
      },
      streamFn: deps.llmAdapter.createStreamFn(role.model),
      getApiKey: deps.llmAdapter.createGetApiKey(),
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
    const deps = this.requireDeps();

    const executionContext: Partial<ToolExecutionContext> = {
      sessionKey,
      sendMessage,
      toolPermission: role.toolPermission,
    };

    const { prompt, tools } = deps.promptBuilder.buildSystemPrompt(role, executionContext);
    const model = deps.llmAdapter.resolveModel(role.model);

    const toolMap = new Map(tools.map((t) => [t.name, t]));
    const worker = new Worker(WORKER_PATH);

    try {
      const workerResult = await new Promise<RunAgentTurnResult>((resolve, reject) => {
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        worker.on('message', async (msg) => {
          if (msg.type === 'done') {
            resolve({
              newMessages: msg.newMessages as AgentMessage[],
              lastAssistant: msg.lastAssistant as string | null,
            });
          } else if (msg.type === 'toolCall') {
            const tool = toolMap.get(msg.toolName);
            if (!tool) {
              worker.postMessage({
                type: 'toolResult',
                callId: msg.callId,
                error: `工具 "${msg.toolName}" 未找到`,
              });
              return;
            }
            try {
              const result = await tool.execute(msg.toolCallId as string, msg.params);
              worker.postMessage({ type: 'toolResult', callId: msg.callId, result });
            } catch (err) {
              worker.postMessage({
                type: 'toolResult',
                callId: msg.callId,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          } else if (msg.type === 'fatal') {
            reject(new Error(msg.message as string));
          }
        });
        worker.on('error', reject);

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
      void worker.terminate();
    }
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
    const model = this.requireDeps().llmAdapter.resolveModel(modelIdentifier);
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
    const llmAdapter = this.requireDeps().llmAdapter;
    let history = await memory.loadHistory();
    if (memory.shouldCompact(history)) {
      await memory.compact(llmAdapter, role.model);
      history = await memory.loadHistory();
    }
    return history;
  }
}
