import { Agent as PiAgent } from '@mariozechner/pi-agent-core';
import { randomUUID } from 'node:crypto';
import type { RoleConfig, InboundMessage, OutboundMessage, SessionKey } from '../core/types';
import type { Agent, AgentMessage } from './agent-types';
import { extractMessageText } from './agent-types';
import type { ToolExecutionContext } from '../tool/tool-registry';
import type { LlmAdapter } from './llm-adapter';
import type { PromptBuilder } from './prompt-builder';
import type { MemoryManager } from './memory-manager';
import { createScopedLogger } from '../core/logger';
import { requireInitialized } from '../core/utils';

const logger = createScopedLogger('agent-engine');

export type AgentEngineDependencies = {
  llmAdapter: LlmAdapter;
  promptBuilder: PromptBuilder;
}

export type ProcessEphemeralParams = {
  sessionKey: SessionKey;
  sessionId: string;
  memory: MemoryManager;
  role: RoleConfig;
  content: string;
}

export class AgentEngine {
  private deps: AgentEngineDependencies | null = null;

  initialize(deps: AgentEngineDependencies): void {
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
    memory: MemoryManager,
    role: RoleConfig,
    sendMessage?: ToolExecutionContext['sendMessage'],
  ): Promise<OutboundMessage> {
    const deps = this.requireDeps();

    logger.debug('正在处理消息', {
      sessionKey: message.sessionKey,
      role: role.id,
      contentLength: message.content.length,
    });

    const history = await this.loadHistoryForTurn(memory, role);

    const executionContext: Partial<ToolExecutionContext> = {
      sessionKey: message.sessionKey,
      sendMessage,
      toolPermission: role.toolPermission,
    };

    const { prompt, tools } = deps.promptBuilder.buildSystemPrompt(role, executionContext);
    agent.state.systemPrompt = prompt;
    agent.state.tools = tools;
    agent.state.model = deps.llmAdapter.resolveModel(role.model);

    const { newMessages, lastAssistant } = await this.promptAgent(agent, history, message.content);
    await memory.syncFromAgent(newMessages);

    if (lastAssistant) {
      return { content: lastAssistant };
    }

    const lastMessage =
      newMessages[newMessages.length - 1] ?? agent.state.messages[agent.state.messages.length - 1];

    logger.warn('Agent 未生成助手文本回复', {
      role: role.id,
      toolCountInPrompt: tools.length,
    });

    return {
      content:
        lastMessage !== undefined &&
        lastMessage.role !== 'user' &&
        extractMessageText(lastMessage).trim().length > 0
          ? extractMessageText(lastMessage)
          : '[未生成回复]',
    };
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
      return { content: lastAssistant };
    }

    logger.warn('临时 Agent 未生成助手文本回复', {
      role: role.id,
    });

    return { content: '[未生成回复]' };
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
