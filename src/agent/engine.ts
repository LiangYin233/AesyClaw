import { randomUUID } from 'crypto';
import {
  AgentContext,
  AesyiuEngine,
  AnthropicProvider,
  MemoryManager,
  OpenAICompletionProvider,
  OpenAIResponsesProvider,
  type AgentSkill,
  type Message as AesyiuMessage,
  type ModelDefinition,
  type Tool as AesyiuTool,
} from 'aesyiu';
import type { IRoleManager } from '../contracts/role-manager.js';
import { logger } from '../platform/observability/logger.js';
import { pluginManager } from '../features/plugins/plugin-manager.js';
import { buildHookSkills, buildHookTools } from '../features/plugins/hook-utils.js';
import { roleManager } from '../features/roles/role-manager.js';
import { skillManager } from '../features/skills/skill-manager.js';
import { configManager } from '../features/config/config-manager.js';
import { toolRegistry } from '../platform/tools/registry.js';
import { ITool, ToolExecuteContext, ToolExecutionResult } from '../platform/tools/types.js';
import { LLMConfig, LLMProviderType, MessageRole, StandardMessage } from '../platform/llm/types.js';
import { MessageFactory } from './message-factory.js';
import {
  SessionMemoryManager,
  MemoryConfig,
} from './memory/index.js';
import { parseModelIdentifier } from '../platform/utils/model-parser.js';
import { mapProviderType } from '../platform/utils/llm-utils.js';

export interface AgentConfig {
  llm: LLMConfig;
  maxSteps?: number;
  systemPrompt?: string;
  memory?: SessionMemoryManager;
  tools?: string[];
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

interface RunStats {
  steps: number;
  toolCalls: number;
  error?: string;
}

function parseToolArguments(argumentsText: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(argumentsText);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function toAesyiuMessage(message: StandardMessage): AesyiuMessage {
  return {
    role: message.role,
    content: message.content,
    ...(message.toolCalls && message.toolCalls.length > 0
      ? {
          tool_calls: message.toolCalls.map(toolCall => ({
            id: toolCall.id,
            name: toolCall.name,
            arguments: JSON.stringify(toolCall.arguments ?? {}),
          })),
        }
      : {}),
    ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
  };
}

function toStandardMessage(message: AesyiuMessage): StandardMessage {
  return {
    role: message.role as MessageRole,
    content: message.content ?? '',
    ...(message.tool_calls && message.tool_calls.length > 0
      ? {
          toolCalls: message.tool_calls.map(toolCall => ({
            id: toolCall.id,
            name: toolCall.name,
            arguments: parseToolArguments(toolCall.arguments),
          })),
        }
      : {}),
    ...(message.tool_call_id ? { toolCallId: message.tool_call_id } : {}),
  };
}

function getFinalAssistantText(messages: readonly AesyiuMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role === 'assistant' && !message.tool_calls?.length) {
      return message.content ?? '';
    }
  }

  return '';
}

export class AgentEngine {
  readonly chatId: string;
  private instanceId: string;
  private config: Required<Omit<AgentConfig, 'memory'>> & { memory?: SessionMemoryManager };
  private memory: SessionMemoryManager;

  constructor(chatId: string, config: AgentConfig) {
    this.chatId = chatId;
    this.instanceId = `agent-${chatId}-${Date.now()}`;
    this.config = {
      maxSteps: config.maxSteps || 15,
      systemPrompt: config.systemPrompt || '你是一个有帮助的AI助手。',
      tools: config.tools || [],
      llm: config.llm,
      memory: config.memory,
      memoryConfig: config.memoryConfig || {},
    };

    this.memory = config.memory ?? new SessionMemoryManager(chatId, this.config.memoryConfig, {
      systemPromptBuilder: {
        buildSystemPrompt: ({ roleId, chatId: currentChatId }) => this.config.systemPrompt || `${roleId}:${currentChatId}`,
      },
      roleManager: roleManager as unknown as IRoleManager,
    });

    if (!this.memory.hasMessages()) {
      this.memory.importMemory([MessageFactory.createSystemMessage(this.config.systemPrompt)]);
    }

    logger.info(
      {
        chatId: this.chatId,
        instanceId: this.instanceId,
        model: this.config.llm.model,
        maxSteps: this.config.maxSteps,
      },
      'AgentEngine initialized with aesyiu runtime'
    );
  }

  private resolveModelDefinition(modelId: string): ModelDefinition {
    const providers = configManager.config.providers;
    const contextLimit = this.config.memoryConfig.maxContextTokens || 128000;

    for (const providerConfig of Object.values(providers)) {
      if (!providerConfig.models) {
        continue;
      }

      for (const modelConfig of Object.values(providerConfig.models)) {
        if (modelConfig.modelname === modelId) {
          const contextWindow = Math.min(modelConfig.contextWindow, contextLimit);
          return {
            id: modelConfig.modelname,
            contextWindow,
            maxOutputTokens: Math.min(16384, contextWindow),
          };
        }
      }
    }

    return {
      id: modelId,
      contextWindow: contextLimit,
      maxOutputTokens: Math.min(16384, contextLimit),
    };
  }

  private createProvider(
    stats: RunStats,
    hookTools: ReturnType<typeof buildHookTools>,
    hookSkills: ReturnType<typeof buildHookSkills>
  ) {
    const modelId = this.config.llm.model || 'gpt-4o-mini';
    const modelDef = this.resolveModelDefinition(modelId);
    const providerConfig = {
      apiKey: this.config.llm.apiKey || '',
      baseURL: this.config.llm.baseUrl,
    };

    const provider = (() => {
      switch (this.config.llm.provider) {
        case LLMProviderType.OpenAICompletion:
          return new OpenAICompletionProvider(providerConfig, [modelDef]);
        case LLMProviderType.Anthropic:
          return new AnthropicProvider(providerConfig, [modelDef]);
        case LLMProviderType.OpenAIChat:
        default:
          return new OpenAIResponsesProvider(providerConfig, [modelDef]);
      }
    })();

    const originalGenerate = provider.generate.bind(provider);
    provider.generate = async (activeModel, messages, tools) => {
      stats.steps += 1;

      try {
        await pluginManager.dispatchBeforeLLMRequest({
          messages: messages.map(toStandardMessage),
          tools: hookTools,
          skills: hookSkills,
        });
      } catch (error) {
        stats.error = error instanceof Error ? error.message : String(error);
        throw error;
      }

      try {
        return await originalGenerate(activeModel, messages, tools);
      } catch (error) {
        stats.error = error instanceof Error ? error.message : String(error);
        throw error;
      }
    };

    return provider;
  }

  private getFilteredTools(): ITool[] {
    const allToolDefs = toolRegistry.getAllToolDefinitions();
    const roleId = this.memory.getActiveRoleId();
    const allowedToolNames = roleManager.getAllowedTools(
      roleId,
      allToolDefs.map(tool => tool.name)
    );

    const configuredToolSet = this.config.tools.length > 0 ? new Set(this.config.tools) : null;

    return allowedToolNames
      .filter(toolName => !configuredToolSet || configuredToolSet.has(toolName))
      .map(toolName => toolRegistry.getTool(toolName))
      .filter((tool): tool is ITool => Boolean(tool));
  }

  private getAllowedSkills(roleId: string): AgentSkill[] {
    if (!skillManager.isInitialized()) {
      return [];
    }

    const allowedSkillIds = roleManager.getRoleConfig(roleId).allowed_skills;
    return skillManager.getSkillsForRole(allowedSkillIds);
  }

  private createRunTools(tools: readonly ITool[], stats: RunStats): AesyiuTool[] {
    return tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parametersSchema,
      execute: async (args, ctx) => {
        const syntheticToolCallId = randomUUID();
        const parsedArgs = args && typeof args === 'object' ? args as Record<string, unknown> : {};
        const toolContext: ToolExecuteContext = {
          chatId: this.chatId,
          senderId: 'user',
          traceId: this.instanceId,
          agentContext: ctx,
        };

        stats.toolCalls += 1;

        const roleId = this.memory.getActiveRoleId();
        if (!roleManager.isToolAllowed(roleId, tool.name)) {
          return {
            success: false,
            content: '',
            error: `角色 "${roleId}" 不允许使用工具 "${tool.name}"。`,
          } satisfies ToolExecutionResult;
        }

        let toolResult = await pluginManager.dispatchBeforeToolCall({
          id: syntheticToolCallId,
          name: tool.name,
          arguments: parsedArgs,
        });

        if (!toolResult) {
          toolResult = await tool.execute(parsedArgs, toolContext);
        }

        return pluginManager.dispatchAfterToolCall({
          toolCall: {
            id: syntheticToolCallId,
            name: tool.name,
            arguments: parsedArgs,
          },
          result: toolResult,
        });
      },
    }));
  }

  private syncMemory(messages: readonly AesyiuMessage[]): void {
    this.memory.importMemory(
      messages
        .filter(message => !message._meta?.skillPrompt)
        .map(toStandardMessage)
    );
  }

  async run(userInput: string): Promise<AgentRunResult> {
    logger.info(
      { chatId: this.chatId, instanceId: this.instanceId, inputLength: userInput.length },
      'AgentEngine starting request processing via aesyiu'
    );

    const stats: RunStats = {
      steps: 0,
      toolCalls: 0,
    };

    try {
      const filteredTools = this.getFilteredTools();
      const roleId = this.memory.getActiveRoleId();
      const allowedSkills = this.getAllowedSkills(roleId);
      const toolDefs = filteredTools.map(tool => tool.getDefinition());
      const hookSkills = buildHookSkills(allowedSkills);
      const hookTools = buildHookTools(toolDefs, allowedSkills);
      const provider = this.createProvider(stats, hookTools, hookSkills);
      const context = new AgentContext({
        provider,
        modelId: this.config.llm.model,
      });

      context.state.chatId = this.chatId;
      context.state.traceId = this.instanceId;

      context.addMessages(this.memory.getMessages().map(toAesyiuMessage));

      const engine = new AesyiuEngine({
        maxSteps: this.config.maxSteps,
        compatibilityMode: true,
        memoryManager: new MemoryManager({
          compressThresholdRatio: this.config.memoryConfig.compressionThreshold || 0.75,
          retainLatestMessages: 8,
        }),
      });

      for (const tool of this.createRunTools(filteredTools, stats)) {
        engine.registerTool(tool);
      }

      engine.registerSkills(allowedSkills);

      const result = await engine.run(
        {
          role: 'user',
          content: userInput,
        },
        context
      );

      this.syncMemory(result.messages);

      const finalText =
        result.status === 'max_steps_reached'
          ? `抱歉，任务在 ${this.config.maxSteps} 步后仍未完成。请简化您的请求或分步进行。`
          : getFinalAssistantText(result.messages);

      logger.info(
        {
          chatId: this.chatId,
          instanceId: this.instanceId,
          status: result.status,
          steps: stats.steps,
          toolCalls: stats.toolCalls,
          tokenUsage: result.usage,
        },
        'AgentEngine run completed via aesyiu'
      );

      if (result.status === 'error') {
        return {
          success: false,
          finalText: `执行错误: ${stats.error || '未知错误'}`,
          steps: stats.steps,
          toolCalls: stats.toolCalls,
          tokenUsage: result.usage,
          error: stats.error || 'Unknown engine error',
        };
      }

      return {
        success: true,
        finalText,
        steps: stats.steps,
        toolCalls: stats.toolCalls,
        tokenUsage: result.usage,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error(
        { chatId: this.chatId, instanceId: this.instanceId, error: errorMessage },
        'AgentEngine execution failed'
      );

      return {
        success: false,
        finalText: `执行错误: ${errorMessage}`,
        steps: stats.steps,
        toolCalls: stats.toolCalls,
        error: errorMessage,
      };
    }
  }

  updateModel(model: string): void {
    try {
      const { providerName, modelAlias } = parseModelIdentifier(model);
      const provider = configManager.config.providers[providerName];
      const resolvedModel = provider?.models?.[modelAlias];

      if (provider && resolvedModel) {
        this.config.llm = {
          ...this.config.llm,
          provider: mapProviderType(provider.type),
          model: resolvedModel.modelname,
          apiKey: provider.api_key,
          baseUrl: provider.base_url,
        };

        logger.info({ chatId: this.chatId, modelIdentifier: model, model: resolvedModel.modelname }, 'Agent model updated from role config');
        return;
      }
    } catch {
      // Fall back to treating the input as a raw model id.
    }

    this.config.llm.model = model;
    logger.info({ chatId: this.chatId, model }, 'Agent model updated');
  }
}
