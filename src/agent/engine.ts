import {
  AgentContext,
  AesyiuEngine,
  MemoryManager,
  type AgentSkill,
  type Message as AesyiuMessage,
} from 'aesyiu';
import { configManager } from '@/features/config/config-manager.js';
import { buildHookSkills, buildHookTools } from '@/features/plugins/hook-utils.js';
import { roleManager } from '@/features/roles/role-manager.js';
import { skillManager } from '@/features/skills/skill-manager.js';
import { resolveLLMConfig } from '@/agent/runtime/resolve-llm-config.js';
import { LLMConfig, MessageRole } from '@/platform/llm/types.js';
import { logger } from '@/platform/observability/logger.js';
import { toolRegistry } from '@/platform/tools/registry.js';
import { ITool, ToolExecuteContext, ToolExecutionResult } from '@/platform/tools/types.js';
import {
  createRolesPromptMessage,
  createHookAwareProvider,
  createHookAwareRunTools,
  getFinalAssistantText,
  isRolePromptMessage,
  resolveModelDefinition,
  toAesyiuMessage,
  toStandardMessage,
} from './runtime/aesyiu-runtime-helpers.js';
import { SessionMemoryManager } from './memory/session-memory-manager.js';
import { SessionMemoryConfig } from './memory/types.js';

export interface AgentEngineConfig {
  llm: LLMConfig;
  maxSteps?: number;
  systemPrompt?: string;
  memory?: SessionMemoryManager;
  tools?: string[];
  memoryConfig?: Partial<SessionMemoryConfig>;
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

export class AgentEngine {
  readonly chatId: string;
  private instanceId: string;
  private config: Required<Omit<AgentEngineConfig, 'memory'>> & { memory?: SessionMemoryManager };
  private memory: SessionMemoryManager;

  constructor(chatId: string, config: AgentEngineConfig) {
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
      roleManager,
    });

    if (!this.memory.hasMessages()) {
      this.memory.importMemory([{ role: MessageRole.System, content: this.config.systemPrompt }]);
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

  private createProvider(
    stats: RunStats,
    hookTools: ReturnType<typeof buildHookTools>,
    hookSkills: ReturnType<typeof buildHookSkills>
  ) {
    const modelId = this.config.llm.model || 'gpt-4o-mini';
    const modelDef = resolveModelDefinition(
      modelId,
      configManager.config.providers,
      this.config.memoryConfig.maxContextTokens || 128000
    );

    return createHookAwareProvider(this.config.llm, modelDef, stats, hookTools, hookSkills);
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

  private createRunTools(tools: readonly ITool[], stats: RunStats) {
    return createHookAwareRunTools(tools, stats, {
      createToolContext: (ctx): ToolExecuteContext => ({
        roleId: this.memory.getActiveRoleId(),
        allowedTools: tools.map(registeredTool => registeredTool.name),
        allowedSkills: this.getAllowedSkills(this.memory.getActiveRoleId()).map(skill => skill.name),
        chatId: this.chatId,
        senderId: 'user',
        traceId: this.instanceId,
        agentContext: ctx,
      }),
      checkToolAllowed: (tool): ToolExecutionResult | null => {
        const roleId = this.memory.getActiveRoleId();
        if (!roleManager.isToolAllowed(roleId, tool.name)) {
          return {
            success: false,
            content: '',
            error: `角色 "${roleId}" 不允许使用工具 "${tool.name}"。`,
          };
        }

        return null;
      },
    });
  }

  private syncMemory(messages: readonly AesyiuMessage[]): void {
    this.memory.importMemory(
      messages
        .filter(message => !message._meta?.skillPrompt && !isRolePromptMessage(message))
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
      const rolesPrompt = createRolesPromptMessage(filteredTools);
      if (rolesPrompt) {
        context.addMessage(rolesPrompt);
      }

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
      const resolved = resolveLLMConfig(model, configManager.config);
      this.config.llm = {
        ...this.config.llm,
        ...resolved,
      };

      logger.info({ chatId: this.chatId, modelIdentifier: model, model: resolved.model }, 'Agent model updated from role config');
      return;
    } catch {
      // Fall back to treating the input as a raw model id.
    }

    this.config.llm.model = model;
    logger.info({ chatId: this.chatId, model }, 'Agent model updated');
  }

  getRuntimeInfo(): { llm: LLMConfig; systemPrompt: string } {
    return {
      llm: { ...this.config.llm },
      systemPrompt: this.config.systemPrompt,
    };
  }
}
