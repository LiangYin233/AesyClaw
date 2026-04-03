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
import {
  SessionMemoryManager,
  MemoryManagerFactory,
  MemoryConfig,
  createMemoryConfig,
} from './memory/index';

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
      this.session = createLLMSession(this.config.llm, this.config.tools);
      
      const messages = this.memory.getMessagesForLLM();
      for (const msg of messages) {
        this.session.addMessage(msg);
      }
    }
    return this.session;
  }

  async run(userInput: string): Promise<AgentRunResult> {
    logger.info(
      { chatId: this.chatId, instanceId: this.instanceId, inputLength: userInput.length },
      '🚀 AgentEngine 开始处理请求'
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
          `🔄 开始第 ${step} 步推理`
        );

        await pluginManager.dispatchBeforeLLMRequest({
          messages: this.memory.getMessages(),
          tools: this.toolRegistry.getAllToolDefinitions(),
        });

        const response = await session.generate(userInput);

        if (response.finishReason === 'error') {
          throw new Error('LLM 返回错误');
        }

        if (response.toolCalls && response.toolCalls.length > 0) {
          totalToolCalls += response.toolCalls.length;
          logger.info(
            { chatId: this.chatId, step, toolCallCount: response.toolCalls.length },
            '🔧 检测到工具调用'
          );

          const toolRequests: ToolCallRequest[] = response.toolCalls.map(tc => ({
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
          }));

          for (const toolRequest of toolRequests) {
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
    if (this.config.systemPrompt) {
      this.memory.addMessage({
        role: MessageRole.System,
        content: this.config.systemPrompt,
      });
    }
    this.session = null;
    logger.debug({ chatId: this.chatId }, '🗑️ Agent 历史已清空');
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
}

export class AgentManager {
  private static instance: AgentManager;
  private agents: Map<string, AgentEngine>;
  private defaultConfig: Required<AgentConfig>;

  private constructor() {
    this.agents = new Map();
    this.defaultConfig = {
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
    logger.info('🏭 AgentManager 单例工厂已初始化（支持记忆系统）');
  }

  static getInstance(): AgentManager {
    if (!AgentManager.instance) {
      AgentManager.instance = new AgentManager();
    }
    return AgentManager.instance;
  }

  getOrCreate(chatId: string, config?: Partial<AgentConfig>): AgentEngine {
    const mergedConfig: AgentConfig = {
      llm: config?.llm || this.defaultConfig.llm,
      maxSteps: config?.maxSteps || this.defaultConfig.maxSteps,
      systemPrompt: config?.systemPrompt || this.defaultConfig.systemPrompt,
      tools: config?.tools || this.defaultConfig.tools,
      memoryConfig: config?.memoryConfig || this.defaultConfig.memoryConfig,
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
      logger.info({ chatId, remainingAgents: this.agents.size }, '🗑️ Agent 实例已移除');
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
    logger.info('🗑️ 所有 Agent 实例和记忆已清空');
  }

  setDefaultConfig(config: Partial<AgentConfig>): void {
    this.defaultConfig = {
      ...this.defaultConfig,
      ...config,
      memoryConfig: config.memoryConfig || this.defaultConfig.memoryConfig,
    };
    logger.info({ config: this.defaultConfig }, '📝 AgentManager 默认配置已更新');
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
    logger.info({ toolName: this.name, args, traceId: context.traceId }, '🔧 执行简单工具');
    
    await new Promise(resolve => setTimeout(resolve, 100));

    return {
      success: true,
      content: `工具 ${this.name} 执行成功，输入参数: ${JSON.stringify(args)}`,
    };
  }
}
