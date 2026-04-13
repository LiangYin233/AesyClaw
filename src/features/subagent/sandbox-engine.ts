import {
  AgentContext,
  AesyiuEngine,
  AnthropicProvider,
  OpenAICompletionProvider,
  OpenAIResponsesProvider,
  type Message as AesyiuMessage,
  type ModelDefinition,
  type Tool as AesyiuTool,
} from 'aesyiu';
import { toolRegistry } from '../../platform/tools/registry.js';
import { ITool, ToolExecuteContext } from '../../platform/tools/types.js';
import { logger } from '../../platform/observability/logger.js';
import { LLMProviderType, type LLMConfig } from '../../platform/llm/types.js';
import { roleManager, DEFAULT_ROLE_ID } from '../roles/role-manager.js';
import { configManager } from '../config/config-manager.js';
import { resolveLLMConfig } from '../../middlewares/agent.middleware.js';
import type { SandboxConfig, SubAgentResult, SandboxContext } from './types.js';

interface SandboxRunStats {
  steps: number;
  toolCalls: number;
  error?: string;
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

export class SandboxEngine {
  private static activeSandboxes: Map<string, SandboxContext> = new Map();

  private sandboxId: string;
  private parentChatId: string;
  private config: SandboxConfig;
  private agentId: string;
  private memory: AesyiuMessage[] = [];
  private maxSteps: number = 10;

  constructor(parentChatId: string, config: SandboxConfig) {
    this.sandboxId = `sandbox_${parentChatId}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    this.parentChatId = parentChatId;
    this.config = config;
    this.agentId = `subagent_${this.sandboxId}`;

    this.initializeMemory();

    SandboxEngine.activeSandboxes.set(this.sandboxId, {
      sandboxId: this.sandboxId,
      parentChatId: this.parentChatId,
      config: this.config,
      messages: this.memory,
      createdAt: new Date(),
    });

    logger.info(
      {
        sandboxId: this.sandboxId,
        parentChatId: this.parentChatId,
        roleId: config.roleId || 'temp',
        toolCount: config.allowedTools.length,
      },
      'SandboxEngine created with aesyiu runtime'
    );
  }

  private initializeMemory(): void {
    const toolPermissionText = this.config.allowedTools.includes('*')
      ? '你有权限使用所有工具。'
      : `你只能使用以下工具: ${this.config.allowedTools.join(', ')}。`;

    const taskDescription = this.getTaskFromConfig();
    const fullSystemPrompt = `${this.config.systemPrompt}\n\n${toolPermissionText}\n\n任务：${taskDescription}`;

    this.memory = [
      {
        role: 'system',
        content: fullSystemPrompt,
      },
    ];
  }

  private getTaskFromConfig(): string {
    if (this.config.roleId) {
      const role = roleManager.getRole(this.config.roleId);
      return role?.name
        ? `你当前扮演的是【${role.name}】角色。\n\n任务要求：\n${this.extractTaskDescription()}`
        : this.extractTaskDescription();
    }
    return this.extractTaskDescription();
  }

  private extractTaskDescription(): string {
    const systemPrompt = this.config.systemPrompt;
    const taskMatch = systemPrompt.match(/任务[：:]\s*(.+?)(?:\n|$)/i);
    if (taskMatch) {
      return taskMatch[1];
    }
    return '执行指定任务';
  }

  private getFilteredTools(): ITool[] {
    const allTools = toolRegistry.getAllToolDefinitions();
    const allowedNames = this.config.allowedTools.includes('*')
      ? allTools.map(tool => tool.name)
      : allTools.filter(tool => this.config.allowedTools.includes(tool.name)).map(tool => tool.name);

    return allowedNames
      .map(toolName => toolRegistry.getTool(toolName))
      .filter((tool): tool is ITool => Boolean(tool));
  }

  private resolveModelDefinition(modelId: string): ModelDefinition {
    const providers = configManager.config.providers;

    for (const providerConfig of Object.values(providers)) {
      if (!providerConfig.models) {
        continue;
      }

      for (const modelConfig of Object.values(providerConfig.models)) {
        if (modelConfig.modelname === modelId) {
          return {
            id: modelConfig.modelname,
            contextWindow: modelConfig.contextWindow,
            maxOutputTokens: Math.min(16384, modelConfig.contextWindow),
          };
        }
      }
    }

    return {
      id: modelId,
      contextWindow: 128000,
      maxOutputTokens: 16384,
    };
  }

  private createProvider(stats: SandboxRunStats, llmConfig: LLMConfig) {
    const modelId = llmConfig.model || 'gpt-4o-mini';
    const modelDef = this.resolveModelDefinition(modelId);
    const providerConfig = {
      apiKey: llmConfig.apiKey || '',
      baseURL: llmConfig.baseUrl,
    };

    const provider = (() => {
      switch (llmConfig.provider) {
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
        return await originalGenerate(activeModel, messages, tools);
      } catch (error) {
        stats.error = error instanceof Error ? error.message : String(error);
        throw error;
      }
    };

    return provider;
  }

  private createRunTools(tools: readonly ITool[], stats: SandboxRunStats): AesyiuTool[] {
    return tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parametersSchema,
      execute: async (args, ctx) => {
        const parsedArgs = args && typeof args === 'object' ? args as Record<string, unknown> : {};
        const toolContext: ToolExecuteContext = {
          chatId: this.agentId,
          senderId: 'subagent',
          traceId: this.sandboxId,
          agentContext: ctx,
        };

        if (!this.config.allowedTools.includes('*') && !this.config.allowedTools.includes(tool.name)) {
          return {
            success: false,
            content: '',
            error: `工具 "${tool.name}" 不在允许列表中`,
          };
        }

        stats.toolCalls += 1;
        return tool.execute(parsedArgs, toolContext);
      },
    }));
  }

  async execute(): Promise<SubAgentResult> {
    const startTime = Date.now();

    logger.info(
      { sandboxId: this.sandboxId },
      'Starting sub-agent execution via aesyiu'
    );

    try {
      const filteredTools = this.getFilteredTools();
      const llmConfig = this.getLLMConfig();
      const stats: SandboxRunStats = {
        steps: 0,
        toolCalls: 0,
      };

      const provider = this.createProvider(stats, llmConfig);
      const context = new AgentContext({
        provider,
        modelId: llmConfig.model,
      });

      context.state.chatId = this.agentId;
      context.state.traceId = this.sandboxId;
      context.addMessages(this.memory);

      const engine = new AesyiuEngine({
        maxSteps: this.maxSteps,
        compatibilityMode: true,
      });

      for (const tool of this.createRunTools(filteredTools, stats)) {
        engine.registerTool(tool);
      }

      const result = await engine.run(
        {
          role: 'user',
          content: this.extractTaskDescription(),
        },
        context
      );

      this.memory = [...result.messages];

      let lastAssistantMessage = getFinalAssistantText(result.messages);
      if (!lastAssistantMessage) {
        lastAssistantMessage = result.status === 'max_steps_reached'
          ? '[无输出] 子代理达到最大步数，未能产出最终结果'
          : '[无输出] 子代理未能产生有效输出';
      }

      const executionTime = Date.now() - startTime;

      logger.info(
        {
          sandboxId: this.sandboxId,
          status: result.status,
          steps: stats.steps,
          toolCalls: stats.toolCalls,
          executionTime,
          outputLength: lastAssistantMessage.length,
        },
        'Sub-agent execution completed'
      );

      this.destroy();

      return {
        success: result.status !== 'error',
        finalText: lastAssistantMessage,
        roleId: this.config.roleId || 'temp',
        executionTime,
        ...(result.status === 'error'
          ? { error: stats.error || '子代理执行失败' }
          : {}),
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error(
        { sandboxId: this.sandboxId, error: errorMessage },
        'Sub-agent execution failed'
      );

      this.destroy();

      return {
        success: false,
        finalText: '',
        roleId: this.config.roleId || 'temp',
        executionTime,
        error: errorMessage,
      };
    }
  }

  private getLLMConfig(): LLMConfig {
    try {
      const config = configManager.config;
      const defaultRole = roleManager.getRoleConfig(DEFAULT_ROLE_ID);
      const modelIdentifier = defaultRole.model;
      return resolveLLMConfig(modelIdentifier, config);
    } catch (error) {
      logger.warn({ error }, 'Failed to resolve LLM config from config.json, using fallback');
      return {
        provider: LLMProviderType.OpenAIChat,
        model: 'gpt-4o-mini',
      };
    }
  }

  destroy(): void {
    SandboxEngine.activeSandboxes.delete(this.sandboxId);
    this.memory = [];

    logger.debug({ sandboxId: this.sandboxId }, 'Sandbox destroyed');
  }
}
