/**
 * AgentEngine — creates Agent instances, processes messages, and manages models.
 *
 * The AgentEngine is the central orchestrator for the AI agent subsystem.
 * It creates agent instances for sessions, processes inbound messages through
 * the agent, and handles model switching.
 *
 * For now, agent instances are SimulatedAgent stubs. When Pi-mono integration
 * is available, this will create real Pi-mono Agent instances.
 *
 * @see project.md §5.8
 */

import type { ConfigManager } from '../core/config/config-manager';
import type { RoleConfig, InboundMessage, OutboundMessage } from '../core/types';
import type { Agent, AgentState, ResolvedModel } from './agent-types';
import { SimulatedAgent } from './agent-types';
import type { ToolRegistry, ToolExecutionContext } from '../tool/tool-registry';
import type { RoleManager } from '../role/role-manager';
import type { SkillManager } from '../skill/skill-manager';
import type { HookDispatcher } from '../pipeline/hook-dispatcher';
import type { LlmAdapter } from './llm-adapter';
import { PromptBuilder } from './prompt-builder';
import { MemoryManager } from './memory-manager';
import type { MessageRepository } from '../core/database/repositories/message-repository';
import { createScopedLogger } from '../core/logger';

const logger = createScopedLogger('agent-engine');

// ─── AgentEngine ────────────────────────────────────────────────

/**
 * Dependencies injected into AgentEngine on initialization.
 */
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

  // ─── Lifecycle ────────────────────────────────────────────────

  /**
   * Initialize the engine with its dependencies.
   */
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

  // ─── Agent creation ──────────────────────────────────────────

  /**
   * Create a new Agent instance for a session.
   *
   * Builds the system prompt, resolves tools, and creates a SimulatedAgent
   * with the appropriate state. When Pi-mono integration is available,
   * this will create a real Pi-mono Agent instance.
   *
   * @param role - The role configuration for this agent
   * @param sessionId - The session ID (used in tool execution context)
   * @param memory - The session's memory manager for conversation history
   * @param executionContext - Optional tool execution context
   * @returns A new Agent instance
   */
  createAgent(
    role: RoleConfig,
    sessionId: string,
    memory: MemoryManager,
    executionContext?: Partial<ToolExecutionContext>,
  ): Agent {
    if (!this.initialized || !this.promptBuilder || !this.llmAdapter || !this.configManager) {
      throw new Error('AgentEngine not initialized');
    }

    // Build system prompt and resolve tools
    const { prompt, tools } = this.promptBuilder.buildSystemPrompt(role, executionContext);

    // Resolve the model from the role's model identifier
    const model = this.llmAdapter.resolveModel(role.model);

    // Create the agent state
    const state: AgentState = {
      systemPrompt: prompt,
      model,
      tools,
      messages: [],
    };

    // Create SimulatedAgent (will be replaced with real Pi-mono Agent)
    const agent = new SimulatedAgent(state);

    logger.debug('Agent created', {
      role: role.id,
      model: role.model,
      toolCount: tools.length,
    });

    return agent;
  }

  // ─── Message processing ───────────────────────────────────────

  /**
   * Process an inbound message through the agent.
   *
   * Flow (per project.md §5.8):
   * 1. Build/rebuild the agent state (prompt, tools, model)
   * 2. Load history from memory and populate agent state
   * 3. Call agent.prompt(userContent)
   * 4. Await agent.waitForIdle()
   * 5. Sync memory from agent state
   * 6. Extract and return the last assistant message as OutboundMessage
   *
   * @param agent - The agent instance to process through
   * @param message - The inbound message to process
   * @param memory - The session's memory manager
   * @param role - The active role configuration
   * @returns The outbound response message
   */
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

    // 1. Load history and populate agent state
    const history = await memory.loadHistory();
    agent.state.messages = history;

    // 2. Rebuild the system prompt and tools for the current role
    const executionContext: Partial<ToolExecutionContext> = {
      sessionKey: message.sessionKey,
    };

    const { prompt, tools } = this.promptBuilder.buildSystemPrompt(role, executionContext);
    agent.state.systemPrompt = prompt;
    agent.state.tools = tools;

    // Update model in case role changed
    const model = this.llmAdapter.resolveModel(role.model);
    agent.state.model = model;

    // 3. Process through agent
    agent.prompt(message.content);

    // 4. Wait for agent to finish processing
    await agent.waitForIdle();

    // 5. Sync memory with agent state
    await memory.syncFromAgent(agent.state.messages);

    // 6. Extract the last assistant message
    const assistantMessages = agent.state.messages.filter(
      (m) => m.role === 'assistant' && (!m.toolCalls || m.toolCalls.length === 0),
    );

    const lastAssistant = assistantMessages[assistantMessages.length - 1];

    if (lastAssistant && lastAssistant.text) {
      return {
        content: lastAssistant.text,
        attachments: message.attachments
          ? // Forward any relevant attachments (stub — no actual conversion)
            undefined
          : undefined,
      };
    }

    // Fallback: return the last message text regardless of role
    const lastMessage = agent.state.messages[agent.state.messages.length - 1];

    return {
      content: lastMessage?.text ?? '[No response generated]',
    };
  }

  // ─── Model switching ──────────────────────────────────────────

  /**
   * Switch the model for an existing agent session.
   *
   * Updates the agent's model state. The next call to process()
   * will use the new model.
   *
   * @param agent - The agent instance to update
   * @param modelIdentifier - The new "provider/model" identifier
   */
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