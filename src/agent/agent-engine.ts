import { Agent as PiAgent } from '@mariozechner/pi-agent-core';
import { randomUUID } from 'node:crypto';
import type { ConfigManager } from '../core/config/config-manager';
import type { RoleConfig, InboundMessage, OutboundMessage, SessionKey } from '../core/types';
import type { Agent, AgentMessage } from './agent-types';
import { extractMessageText } from './agent-types';
import type { ToolRegistry, ToolExecutionContext } from '../tool/tool-registry';
import type { RoleManager } from '../role/role-manager';
import type { SkillManager } from '../skill/skill-manager';
import type { HookDispatcher } from '../pipeline/hook-dispatcher';
import type { LlmAdapter } from './llm-adapter';
import { PromptBuilder } from './prompt-builder';
import type { MemoryManager } from './memory-manager';
import { createScopedLogger } from '../core/logger';
import { AgentRunPolicy } from './agent-run-policy';

const logger = createScopedLogger('agent-engine');

export type AgentEngineDependencies = {
  configManager: ConfigManager;
  toolRegistry: ToolRegistry;
  roleManager: RoleManager;
  skillManager: SkillManager;
  hookDispatcher: HookDispatcher;
  llmAdapter: LlmAdapter;
}

export type ProcessEphemeralParams = {
  sessionKey: SessionKey;
  sessionId: string;
  memory: MemoryManager;
  role: RoleConfig;
  content: string;
}

export class AgentEngine {
  private initialized = false;
  private llmAdapter: LlmAdapter | null = null;
  private promptBuilder: PromptBuilder | null = null;
  private runPolicy: AgentRunPolicy | null = null;

  initialize(deps: AgentEngineDependencies): void {
    if (this.initialized) {
      logger.warn('AgentEngine 已初始化 — 跳过');
      return;
    }

    this.llmAdapter = deps.llmAdapter;

    this.promptBuilder = new PromptBuilder({
      roleManager: deps.roleManager,
      skillManager: deps.skillManager,
      toolRegistry: deps.toolRegistry,
      hookDispatcher: deps.hookDispatcher,
    });
    this.runPolicy = new AgentRunPolicy({
      configManager: deps.configManager,
      llmAdapter: deps.llmAdapter,
    });

    this.initialized = true;
    logger.info('AgentEngine 已初始化');
  }

  createAgent(
    role: RoleConfig,
    sessionId: string,
    executionContext?: Partial<ToolExecutionContext>,
  ): Agent {
    if (!this.initialized || !this.promptBuilder || !this.llmAdapter || !this.runPolicy) {
      throw new Error('AgentEngine 未初始化');
    }

    const { prompt, tools } = this.promptBuilder.buildSystemPrompt(role, executionContext);
    const model = this.llmAdapter.resolveModel(role.model);

    const agent = new PiAgent({
      initialState: {
        systemPrompt: prompt,
        model,
        tools,
        messages: [],
      },
      streamFn: this.llmAdapter.createStreamFn(role.model),
      getApiKey: this.llmAdapter.createGetApiKey(),
      sessionId,
    });

    logger.debug('Agent 已创建', {
      role: role.id,
      model: role.model,
      toolCount: tools.length,
      runtimeToolCount: tools.length,
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
    if (!this.initialized || !this.promptBuilder || !this.llmAdapter || !this.runPolicy) {
      throw new Error('AgentEngine 未初始化');
    }

    logger.debug('正在处理消息', {
      sessionKey: message.sessionKey,
      role: role.id,
      contentLength: message.content.length,
    });

    const history = await this.runPolicy.loadHistoryForTurn(memory, role);
    agent.state.messages = history;

    const executionContext: Partial<ToolExecutionContext> = {
      sessionKey: message.sessionKey,
      sendMessage,
      toolPermission: role.toolPermission,
    };

    const { prompt, tools } = this.promptBuilder.buildSystemPrompt(role, executionContext);
    agent.state.systemPrompt = prompt;
    agent.state.tools = tools;
    agent.state.model = this.llmAdapter.resolveModel(role.model);

    await this.runPolicy.prompt(agent, message.content);

    const newMessages = agent.state.messages.slice(history.length);
    await memory.syncFromAgent(newMessages);

    const lastAssistant = findLastAssistantText(newMessages);

    if (lastAssistant) {
      return {
        content: lastAssistant,
      };
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
    if (!this.initialized || !this.promptBuilder || !this.llmAdapter || !this.runPolicy) {
      throw new Error('AgentEngine 未初始化');
    }

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
    agent.state.messages = history;
    agent.state.tools = [];

    await this.runPolicy.prompt(agent, content);

    const newMessages = agent.state.messages.slice(history.length);
    const lastAssistant = findLastAssistantText(newMessages);

    if (lastAssistant) {
      return { content: lastAssistant };
    }

    logger.warn('临时 Agent 未生成助手文本回复', {
      role: role.id,
    });

    return { content: '[未生成回复]' };
  }

  switchModel(agent: Agent, modelIdentifier: string): void {
    if (!this.llmAdapter) {
      throw new Error('AgentEngine 未初始化');
    }

    const model = this.llmAdapter.resolveModel(modelIdentifier);
    agent.state.model = model;

    logger.info('模型已切换', {
      provider: model.provider,
      modelId: model.modelId,
    });
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
