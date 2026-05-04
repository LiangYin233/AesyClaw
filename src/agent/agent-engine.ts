import { Agent as PiAgent } from '@mariozechner/pi-agent-core';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type {
  RoleConfig,
  InboundMessage,
  OutboundMessage,
  SessionKey,
  SenderInfo,
} from '@aesyclaw/core/types';
import { getMessageText } from '@aesyclaw/core/types';
import type { Agent, AgentMessage } from './agent-types';
import { extractMessageText } from './agent-types';
import type { ToolExecutionContext } from '@aesyclaw/tool/tool-registry';
import type { LlmAdapter } from './llm-adapter';
import type { PromptBuilder } from './prompt-builder';
import type { MemoryManager } from './memory-manager';
import { createScopedLogger } from '@aesyclaw/core/logger';
import { requireInitialized } from '@aesyclaw/core/utils';

const logger = createScopedLogger('agent-engine');
const WORKER_PATH = fileURLToPath(new URL('./agent-worker.ts', import.meta.url));

function isTestEnv(): boolean {
  return process.env['VITEST'] !== undefined || process.env['NODE_ENV'] === 'test';
}

export type AgentEngineDependencies = {
  llmAdapter: LlmAdapter;
  promptBuilder: PromptBuilder;
};

export type ProcessEphemeralParams = {
  sessionKey: SessionKey;
  sessionId: string;
  memory: MemoryManager;
  role: RoleConfig;
  content: string;
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

  async process(
    agent: Agent,
    message: InboundMessage,
    sessionKey: SessionKey,
    sender: SenderInfo | undefined,
    memory: MemoryManager,
    role: RoleConfig,
    sendMessage?: ToolExecutionContext['sendMessage'],
  ): Promise<OutboundMessage> {
    const deps = this.requireDeps();
    const content = getMessageText(message);

    logger.debug('正在处理消息', {
      sessionKey,
      role: role.id,
      contentLength: content.length,
    });

    const history = await this.loadHistoryForTurn(memory, role);

    const executionContext: Partial<ToolExecutionContext> = {
      sessionKey,
      sendMessage,
      toolPermission: role.toolPermission,
    };

    const { prompt, tools } = deps.promptBuilder.buildSystemPrompt(role, executionContext);
    const model = deps.llmAdapter.resolveModel(role.model);

    // 测试环境回退内联 PiAgent（Worker 无法访问 vitest loader）
    if (isTestEnv()) {
      agent.state.systemPrompt = prompt;
      agent.state.tools = tools;
      agent.state.model = model;
      const result = await this.promptAgent(agent, history, content);
      await memory.syncFromAgent(result.newMessages);

      if (result.lastAssistant) {
        return { components: [{ type: 'Plain', text: result.lastAssistant }] };
      }

      logger.warn('Agent 未生成助手文本回复', {
        role: role.id,
        toolCountInPrompt: tools.length,
      });

      return { components: [{ type: 'Plain', text: '[未生成回复]' }] };
    }

    // 生产环境：在独立 Worker 线程中运行 PiAgent
    const toolMap = new Map(tools.map((t) => [t.name, t]));
    const worker = new Worker(WORKER_PATH);

    try {
      const workerResult = await new Promise<{
        newMessages: AgentMessage[];
        lastAssistant: string | null;
      }>((resolve, reject) => {
        worker.on('message', async (msg: any) => {
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

      await memory.syncFromAgent(workerResult.newMessages);

      if (workerResult.lastAssistant) {
        return { components: [{ type: 'Plain', text: workerResult.lastAssistant }] };
      }

      logger.warn('Agent 未生成助手文本回复', {
        role: role.id,
        toolCountInPrompt: tools.length,
      });

      return { components: [{ type: 'Plain', text: '[未生成回复]' }] };
    } finally {
      worker.terminate();
    }
  }

  async processEphemeral(params: ProcessEphemeralParams): Promise<OutboundMessage> {
    this.requireDeps();

    const { sessionKey, sessionId, memory, role, content } = params;
    const history = await memory.loadHistory();
    const ephemeralRole: RoleConfig = {
      ...role,
      toolPermission: { mode: 'allowlist', list: [] },
    };
    const agent = this.createAgent(ephemeralRole, `btw:${sessionId}:${randomUUID()}`, {
      sessionKey,
      toolPermission: ephemeralRole.toolPermission,
    });
    agent.state.tools = [];

    const { lastAssistant } = await this.promptAgent(agent, history, content);

    if (lastAssistant) {
      return { components: [{ type: 'Plain', text: lastAssistant }] };
    }

    logger.warn('临时 Agent 未生成助手文本回复', {
      role: role.id,
    });

    return { components: [{ type: 'Plain', text: '[未生成回复]' }] };
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

  private async prompt(agent: Agent, content: string): Promise<void> {
    await agent.prompt(content);
    await agent.waitForIdle();
  }

  /**
   * 向 agent 发送提示词并提取响应。
   *
   * 设置 agent.state.messages、调用 prompt() 并返回生成的消息
   * 切片，以及找到的最后一条助手文本（如果有）。
   */
  private async promptAgent(
    agent: Agent,
    history: AgentMessage[],
    content: string,
  ): Promise<{ newMessages: AgentMessage[]; lastAssistant: string | null }> {
    agent.state.messages = history;
    await this.prompt(agent, content);
    const newMessages = agent.state.messages.slice(history.length);
    return { newMessages, lastAssistant: findLastAssistantText(newMessages) };
  }
}

function findLastAssistantText(messages: AgentMessage[]): string | null {
  for (const message of [...messages].reverse()) {
    if (message.role !== 'assistant') {
      continue;
    }

    const text = extractMessageText(message);
    if (text.trim().length > 0) {
      return text;
    }
  }

  return null;
}
