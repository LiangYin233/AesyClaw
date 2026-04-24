import { Agent as PiAgent } from '@mariozechner/pi-agent-core';
import type { ConfigManager } from '../core/config/config-manager';
import type { RoleConfig, InboundMessage, OutboundMessage } from '../core/types';
import type { Agent } from './agent-types';
import { extractMessageText } from './agent-types';
import type { ToolRegistry, ToolExecutionContext } from '../tool/tool-registry';
import type { RoleManager } from '../role/role-manager';
import type { SkillManager } from '../skill/skill-manager';
import type { HookDispatcher } from '../pipeline/hook-dispatcher';
import type { LlmAdapter } from './llm-adapter';
import { PromptBuilder } from './prompt-builder';
import { MemoryManager } from './memory-manager';
import { createScopedLogger } from '../core/logger';

const logger = createScopedLogger('agent-engine');

export interface AgentEngineDependencies {
  configManager: ConfigManager;
  toolRegistry: ToolRegistry;
  roleManager: RoleManager;
  skillManager: SkillManager;
  hookDispatcher: HookDispatcher;
  llmAdapter: LlmAdapter;
}

export class AgentEngine {
  private initialized = false;
  private configManager: ConfigManager | null = null;
  private toolRegistry: ToolRegistry | null = null;
  private roleManager: RoleManager | null = null;
  private skillManager: SkillManager | null = null;
  private hookDispatcher: HookDispatcher | null = null;
  private llmAdapter: LlmAdapter | null = null;
  private promptBuilder: PromptBuilder | null = null;

  initialize(deps: AgentEngineDependencies): void {
    if (this.initialized) {
      logger.warn('AgentEngine already initialized — skipping');
      return;
    }

    this.configManager = deps.configManager;
    this.toolRegistry = deps.toolRegistry;
    this.roleManager = deps.roleManager;
    this.skillManager = deps.skillManager;
    this.hookDispatcher = deps.hookDispatcher;
    this.llmAdapter = deps.llmAdapter;

    this.promptBuilder = new PromptBuilder({
      roleManager: deps.roleManager,
      skillManager: deps.skillManager,
      toolRegistry: deps.toolRegistry,
      hookDispatcher: deps.hookDispatcher,
    });

    this.initialized = true;
    logger.info('AgentEngine initialized');
  }

  createAgent(
    role: RoleConfig,
    sessionId: string,
    _memory: MemoryManager,
    executionContext?: Partial<ToolExecutionContext>,
  ): Agent {
    if (!this.initialized || !this.promptBuilder || !this.llmAdapter) {
      throw new Error('AgentEngine not initialized');
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

    logger.debug('Agent created', {
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
  ): Promise<OutboundMessage> {
    if (!this.initialized || !this.promptBuilder || !this.llmAdapter) {
      throw new Error('AgentEngine not initialized');
    }

    logger.debug('Processing message', {
      sessionKey: message.sessionKey,
      role: role.id,
      contentLength: message.content.length,
    });

    const history = await memory.loadHistory();
    agent.state.messages = history;

    const executionContext: Partial<ToolExecutionContext> = {
      sessionKey: message.sessionKey,
    };

    const { prompt, tools } = this.promptBuilder.buildSystemPrompt(role, executionContext);
    agent.state.systemPrompt = prompt;
    agent.state.tools = tools;
    agent.state.model = this.llmAdapter.resolveModel(role.model);

    await agent.prompt(message.content);
    await agent.waitForIdle();

    const newMessages = agent.state.messages.slice(history.length);
    await memory.syncFromAgent(newMessages);

    const lastAssistant = [...newMessages]
      .reverse()
      .find((runtimeMessage) => runtimeMessage.role === 'assistant' && extractMessageText(runtimeMessage).trim().length > 0);

    if (lastAssistant) {
      return {
        content: extractMessageText(lastAssistant),
      };
    }

    const lastMessage = newMessages[newMessages.length - 1] ?? agent.state.messages[agent.state.messages.length - 1];

    logger.warn('Agent produced no assistant text response', {
      role: role.id,
      toolCountInPrompt: tools.length,
    });

    return {
      content:
        lastMessage && lastMessage.role !== 'user' && extractMessageText(lastMessage).trim().length > 0
          ? extractMessageText(lastMessage)
          : '[No response generated]',
    };
  }

  switchModel(agent: Agent, modelIdentifier: string): void {
    if (!this.llmAdapter) {
      throw new Error('AgentEngine not initialized');
    }

    const model = this.llmAdapter.resolveModel(modelIdentifier);
    agent.state.model = model;

    logger.info('Model switched', {
      provider: model.provider,
      modelId: model.modelId,
    });
  }
}
