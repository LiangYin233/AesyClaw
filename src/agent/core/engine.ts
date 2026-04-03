import { z } from 'zod';
import {
  StandardMessage,
  MessageRole,
  LLMProviderType,
  ToolCall,
} from '../llm/types';
import { LLMConfig, LLMSession, createLLMSession } from '../llm/factory';
import { ToolRegistry } from '../../platform/tools/registry';
import {
  ToolDefinition,
  ToolExecuteContext,
  ToolCallRequest,
  zodToToolParameters,
  ITool,
  ToolExecutionResult,
} from '../../platform/tools/types';
import { logger } from '../../platform/observability/logger';
import { pluginManager } from '../../features/plugins/plugin-manager.js';
import { roleManager, DEFAULT_ROLE_ID } from '../../features/roles/role-manager.js';
import {
  SessionMemoryManager,
  MemoryManagerFactory,
  MemoryConfig,
  createMemoryConfig,
} from './memory/index';
import { configManager } from '../../features/config/config-manager.js';
import { resolveLLMConfig } from '../../middlewares/agent.middleware.js';

export interface AgentConfig {
  llm: LLMConfig;
  maxSteps?: number;
  systemPrompt?: string;
  tools?: ToolDefinition[];
  memoryConfig?: Partial<MemoryConfig>;
}

export interface AgentRunResult {
  success: boolean;
  finalText: string;
  steps: number;
  toolCalls: number;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  error?: string;
}

export class AgentEngine {
  readonly chatId: string;
  private instanceId: string;
  private config: Required<AgentConfig>;
  private session: LLMSession | null = null;
  private toolRegistry: ToolRegistry;
  private tools: ToolDefinition[];
  private maxSteps: number;
  private memory: SessionMemoryManager;

  constructor(chatId: string, config: AgentConfig) {
    this.chatId = chatId;
    this.instanceId = `agent-${chatId}-${Date.now()}`;
    this.config = {
      maxSteps: config.maxSteps || 15,
      systemPrompt: config.systemPrompt || '你是一个有帮助的AI助手。',
      tools: config.tools || [],
      llm: config.llm,
      memoryConfig: config.memoryConfig || {},
    };

    this.toolRegistry = ToolRegistry.getInstance();
    this.tools = this.config.tools;
    this.maxSteps = this.config.maxSteps;
    
    const memoryFactory = MemoryManagerFactory.getInstance();
    this.memory = memoryFactory.getOrCreate(chatId);
    
    if (this.config.memoryConfig) {
      this.memory.updateConfig(this.config.memoryConfig);
    }

    if (!this.memory.hasMessages() && this.config.systemPrompt) {
      this.memory.addMessage({
        role: MessageRole.System,
        content: this.config.systemPrompt,
      });
    }

    logger.info(
      { 
        chatId: this.chatId, 
        instanceId: this.instanceId,
        model: this.config.llm.model,
        maxSteps: this.maxSteps,
        toolCount: this.tools.length,
        memoryConfig: this.config.memoryConfig,
      },
      '🤖 AgentEngine 实例已创建（集成记忆系统）'
    );
  }

  private getSession(): LLMSession {
    if (!this.session) {
      const filteredTools = this.getFilteredTools();
      this.session = createLLMSession(this.config.llm, filteredTools);
      
      const messages = this.memory.getMessagesForLLM();
      for (const msg of messages) {
        this.session.addMessage(msg);
      }

      logger.debug(
        { 
          chatId: this.chatId,
          totalTools: this.toolRegistry.getAllToolDefinitions().length,
          filteredTools: filteredTools.length,
          roleId: this.memory.getActiveRoleId()
        },
        'LLM Session created with role-filtered tools'
      );
    }
    return this.session;
  }

  async run(userInput: string): Promise<AgentRunResult> {
    logger.info(
      { chatId: this.chatId, instanceId: this.instanceId, inputLength: userInput.length },
      'AgentEngine starting request processing'
    );

    this.memory.addMessage({
      role: MessageRole.User,
      content: userInput,
    });

    const session = this.getSession();

    const context: ToolExecuteContext = {
      chatId: this.chatId,
      senderId: 'user',
      traceId: this.instanceId,
    };

    let step = 0;
    let totalToolCalls = 0;
    let finalText = '';

    try {
      while (step < this.maxSteps) {
        step++;
        logger.info(
          { chatId: this.chatId, step, maxSteps: this.maxSteps },
          `Starting step ${step}`
        );

        const filteredTools = this.getFilteredTools();

        await pluginManager.dispatchBeforeLLMRequest({
          messages: this.memory.getMessages(),
          tools: filteredTools,
        });

        const response = await session.generate(userInput);

        if (response.finishReason === 'error') {
          throw new Error('LLM returned error');
        }

        if (response.toolCalls && response.toolCalls.length > 0) {
          totalToolCalls += response.toolCalls.length;
          logger.info(
            { chatId: this.chatId, step, toolCallCount: response.toolCalls.length },
            'Tool calls detected'
          );

          const toolRequests: ToolCallRequest[] = response.toolCalls.map(tc => ({
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
          }));

          for (const toolRequest of toolRequests) {
            const roleId = this.memory.getActiveRoleId();
            if (!roleManager.isToolAllowed(roleId, toolRequest.name)) {
              logger.warn(
                { toolName: toolRequest.name, roleId },
                'Tool blocked by role permission'
              );

              const toolMessage: StandardMessage = {
                role: MessageRole.Tool,
                content: `[权限拒绝] 角色 "${roleId}" 不允许使用工具 "${toolRequest.name}"。`,
                toolCallId: toolRequest.id,
                name: toolRequest.name,
              };
              this.memory.addMessage(toolMessage);
              session.addToolResult(toolRequest.id, toolRequest.name, toolMessage.content);
              continue;
            }

            let toolResult = await pluginManager.dispatchBeforeToolCall({
              id: toolRequest.id,
              name: toolRequest.name,
              arguments: toolRequest.arguments,
            });

            if (!toolResult) {
              const results = await this.toolRegistry.executeTools([toolRequest], context);
              toolResult = {
                success: results[0].success,
                content: results[0].content,
                error: results[0].error,
              };
            }

            const afterResult = await pluginManager.dispatchAfterToolCall({
              toolCall: {
                id: toolRequest.id,
                name: toolRequest.name,
                arguments: toolRequest.arguments,
              },
              result: toolResult,
            });

            const feedbackMessage = afterResult.success
              ? afterResult.content
              : this.toolRegistry.generateHallucinationFeedback(
                  toolRequest.name,
                  { toolName: toolRequest.name, error: afterResult.error || '未知错误' }
                );

            const toolMessage: StandardMessage = {
              role: MessageRole.Tool,
              content: feedbackMessage,
              toolCallId: toolRequest.id,
              name: toolRequest.name,
            };
            this.memory.addMessage(toolMessage);
            session.addToolResult(toolRequest.id, toolRequest.name, feedbackMessage);

            if (!afterResult.success) {
              logger.warn(
                { toolName: toolRequest.name, error: afterResult.error },
                '⚠️ 工具执行失败，将反馈给 LLM'
              );
            }
          }

          continue;
        }

        finalText = response.text;
        
        this.memory.addMessage({
          role: MessageRole.Assistant,
          content: finalText,
        });
        
        logger.info(
          { chatId: this.chatId, step, responseLength: finalText.length },
          '✅ LLM 推理完成，无更多工具调用'
        );
        break;
      }

      if (step >= this.maxSteps) {
        logger.warn(
          { chatId: this.chatId, steps: step },
          '⚠️ 达到最大推理步数限制'
        );
        finalText = `抱歉，任务在 ${this.maxSteps} 步后仍未完成。请简化您的请求或分步进行。`;
      }

      const tokenUsage = session.getTotalTokenUsage();

      logger.info(
        { 
          chatId: this.chatId, 
          instanceId: this.instanceId,
          steps: step,
          toolCalls: totalToolCalls,
          tokenUsage,
        },
        '🎉 AgentEngine 任务完成'
      );

      return {
        success: true,
        finalText,
        steps: step,
        toolCalls: totalToolCalls,
        tokenUsage,
      };
    } catch (error) {
      logger.error(
        { chatId: this.chatId, instanceId: this.instanceId, error },
        '❌ AgentEngine 执行出错'
      );

      return {
        success: false,
        finalText: `执行错误: ${error instanceof Error ? error.message : '未知错误'}`,
        steps: step,
        toolCalls: totalToolCalls,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  getChatId(): string {
    return this.chatId;
  }

  getInstanceId(): string {
    return this.instanceId;
  }

  getHistory(): StandardMessage[] {
    return this.memory.getMessages();
  }

  clearHistory(): void {
    this.memory.clear();
    this.session = null;
    logger.debug({ chatId: this.chatId }, 'Agent history cleared');
  }

  getMemoryStats() {
    return this.memory.getStats();
  }

  getTokenBudget() {
    return this.memory.checkBudget();
  }

  isMemoryCompressing(): boolean {
    return this.memory.isCompressing();
  }

  getMemoryCompressionPhase() {
    return this.memory.getCurrentPhase();
  }

  private getFilteredTools(): ToolDefinition[] {
    const roleId = this.memory.getActiveRoleId();
    const allToolDefs = this.toolRegistry.getAllToolDefinitions();
    const toolNames = allToolDefs.map(t => t.name);
    const allowedToolNames = roleManager.getAllowedTools(roleId, toolNames);

    return allToolDefs.filter(tool => allowedToolNames.includes(tool.name));
  }

  updateModel(model: string): void {
    this.config.llm.model = model;
    this.session = null;
    logger.info({ chatId: this.chatId, model }, 'Agent model updated');
  }

  getCurrentRoleId(): string {
    return this.memory.getActiveRoleId();
  }
}

export class AgentManager {
  private static instance: AgentManager;
  private agents: Map<string, AgentEngine>;
  private _defaultConfig: Required<AgentConfig> | null = null;

  private constructor() {
    this.agents = new Map();
    logger.info('AgentManager singleton factory initialized (with memory system)');
  }

  private buildDefaultConfig(): Required<AgentConfig> {
    try {
      if (configManager.isInitialized() && roleManager.isInitialized()) {
        const config = configManager.getConfig();
        const defaultRole = roleManager.getRoleConfig(DEFAULT_ROLE_ID);
        const modelIdentifier = defaultRole.model;
        const llmConfig = resolveLLMConfig(modelIdentifier, config);

        return {
          llm: llmConfig,
          maxSteps: 15,
          systemPrompt: defaultRole.system_prompt,
          tools: [],
          memoryConfig: {
            maxContextTokens: config.memory.max_context_tokens,
            compressionThreshold: config.memory.compression_threshold,
            dangerThreshold: config.memory.danger_threshold,
          },
        };
      }
    } catch (error) {
      logger.warn({ error }, 'Failed to build default config from config.toml, using fallback');
    }

    return {
      llm: {
        provider: LLMProviderType.OpenAIChat,
        model: 'gpt-4o-mini',
      },
      maxSteps: 15,
      systemPrompt: '你是一个有帮助的AI助手。',
      tools: [],
      memoryConfig: {
        maxContextTokens: 128000,
        compressionThreshold: 80000,
        dangerThreshold: 30000,
      },
    };
  }

  private getDefaultConfig(): Required<AgentConfig> {
    if (!this._defaultConfig) {
      this._defaultConfig = this.buildDefaultConfig();
    }
    return this._defaultConfig;
  }

  static getInstance(): AgentManager {
    if (!AgentManager.instance) {
      AgentManager.instance = new AgentManager();
    }
    return AgentManager.instance;
  }

  getOrCreate(chatId: string, config?: Partial<AgentConfig>): AgentEngine {
    const defaultConfig = this.getDefaultConfig();
    const mergedConfig: AgentConfig = {
      llm: config?.llm || defaultConfig.llm,
      maxSteps: config?.maxSteps || defaultConfig.maxSteps,
      systemPrompt: config?.systemPrompt || defaultConfig.systemPrompt,
      tools: config?.tools || defaultConfig.tools,
      memoryConfig: config?.memoryConfig || defaultConfig.memoryConfig,
    };

    if (!this.agents.has(chatId)) {
      logger.debug(
        { chatId, totalInstances: this.agents.size + 1 },
        '🆕 创建新的 AgentEngine 实例（集成记忆）'
      );
      const agent = new AgentEngine(chatId, mergedConfig);
      this.agents.set(chatId, agent);
    } else {
      const existingAgent = this.agents.get(chatId)!;
      logger.debug(
        { chatId, instanceId: existingAgent.getInstanceId(), totalInstances: this.agents.size },
        '♻️ 复用已存在的 AgentEngine 实例'
      );
    }

    return this.agents.get(chatId)!;
  }

  hasAgent(chatId: string): boolean {
    return this.agents.has(chatId);
  }

  removeAgent(chatId: string): boolean {
    const deleted = this.agents.delete(chatId);
    if (deleted) {
      logger.info({ chatId, remainingAgents: this.agents.size }, 'Agent instance removed');
    }
    return deleted;
  }

  getActiveAgentsCount(): number {
    return this.agents.size;
  }

  getAllChatIds(): string[] {
    return Array.from(this.agents.keys());
  }

  clearAll(): void {
    this.agents.clear();
    MemoryManagerFactory.getInstance().clearAll();
    logger.info('All agent instances and memory cleared');
  }

  setDefaultConfig(config: Partial<AgentConfig>): void {
    const current = this.getDefaultConfig();
    this._defaultConfig = {
      ...current,
      ...config,
      memoryConfig: config.memoryConfig || current.memoryConfig,
    };
    logger.info({ config: this._defaultConfig }, 'AgentManager default config updated');
  }
}

export class SimpleTool implements ITool {
  readonly name: string;
  readonly description: string;
  readonly parametersSchema: z.ZodType;

  constructor(
    name: string,
    description: string,
    parametersSchema: z.ZodType
  ) {
    this.name = name;
    this.description = description;
    this.parametersSchema = parametersSchema;
  }

  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      parameters: zodToToolParameters(this.parametersSchema),
    };
  }

  async execute(
    args: unknown,
    context: ToolExecuteContext
  ): Promise<ToolExecutionResult> {
    logger.info({ toolName: this.name, args, traceId: context.traceId }, 'Executing simple tool');
    
    await new Promise(resolve => setTimeout(resolve, 100));

    return {
      success: true,
      content: `工具 ${this.name} 执行成功，输入参数: ${JSON.stringify(args)}`,
    };
  }
}
