import {
  AgentContext,
  AesyiuEngine,
  MemoryManager,
  type AgentSkill,
  type Message as AesyiuMessage,
} from 'aesyiu';
import { prepareAgentRun } from '@/agent/runtime/prepare-agent-run.js';
import {
  createHookAwareProvider,
  createHookAwareRunTools,
  getFinalAssistantText,
  resolveModelDefinition,
} from '@/agent/runtime/aesyiu-runtime-helpers.js';
import { configManager } from '@/features/config/config-manager.js';
import { buildHookSkills, buildHookTools } from '@/features/plugins/hook-utils.js';
import { roleManager, DEFAULT_ROLE_ID } from '@/features/roles/role-manager.js';
import { skillManager } from '@/features/skills/skill-manager.js';
import { type LLMConfig } from '@/platform/llm/types.js';
import { logger } from '@/platform/observability/logger.js';
import { toolRegistry } from '@/platform/tools/registry.js';
import { ITool, ToolExecuteContext } from '@/platform/tools/types.js';
import { DEFAULT_FALLBACK_LLM_CONFIG } from '@/agent/runtime/resolve-llm-config.js';
import type { SandboxConfig, SubAgentResult, SandboxContext } from './types.js';

interface SandboxRunStats {
  steps: number;
  toolCalls: number;
  error?: string;
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
    const blockTaskMatch = systemPrompt.match(/【任务】\s*([\s\S]+)$/i);
    if (blockTaskMatch) {
      return blockTaskMatch[1].trim();
    }

    const taskMatch = systemPrompt.match(/任务[：:]\s*([\s\S]+)$/i);
    if (taskMatch) {
      return taskMatch[1].trim();
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

  private getAllowedSkills(): AgentSkill[] {
    if (!skillManager.isInitialized()) {
      return [];
    }

    return skillManager.getSkillsForRole(this.config.allowedSkills);
  }

  private createProvider(
    stats: SandboxRunStats,
    llmConfig: LLMConfig,
    hookTools: ReturnType<typeof buildHookTools>,
    hookSkills: ReturnType<typeof buildHookSkills>
  ) {
    const modelId = llmConfig.model || 'gpt-4o-mini';
    const modelDef = resolveModelDefinition(
      modelId,
      configManager.config.providers,
      configManager.config.memory.max_context_tokens
    );

    return createHookAwareProvider(llmConfig, modelDef, stats, hookTools, hookSkills);
  }

  private createRunTools(tools: readonly ITool[], stats: SandboxRunStats) {
    return createHookAwareRunTools(tools, stats, {
      createToolContext: (ctx): ToolExecuteContext => ({
        roleId: this.config.roleId,
        allowedTools: this.config.allowedTools,
        allowedSkills: this.config.allowedSkills,
        chatId: this.agentId,
        senderId: 'subagent',
        traceId: this.sandboxId,
        agentContext: ctx,
      }),
      checkToolAllowed: (tool) => {
        if (!this.config.allowedTools.includes('*') && !this.config.allowedTools.includes(tool.name)) {
          return {
            success: false,
            content: '',
            error: `工具 "${tool.name}" 不在允许列表中`,
          };
        }

        return null;
      },
    });
  }

  async execute(): Promise<SubAgentResult> {
    const startTime = Date.now();

    logger.info(
      { sandboxId: this.sandboxId },
      'Starting sub-agent execution via aesyiu'
    );

    try {
      const filteredTools = this.getFilteredTools();
      const allowedSkills = this.getAllowedSkills();
      const hookSkills = buildHookSkills(allowedSkills);
      const hookTools = buildHookTools(filteredTools.map(tool => tool.getDefinition()), allowedSkills);
      const llmConfig = this.getLLMConfig();
      const stats: SandboxRunStats = {
        steps: 0,
        toolCalls: 0,
      };

      const provider = this.createProvider(stats, llmConfig, hookTools, hookSkills);
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
        memoryManager: new MemoryManager({
          compressThresholdRatio: configManager.config.memory.compression_threshold,
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
          content: this.extractTaskDescription(),
        },
        context
      );

      this.memory = result.messages.filter(message => !message._meta?.skillPrompt);

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
      const roleId = this.config.roleId || DEFAULT_ROLE_ID;
      return prepareAgentRun(this.parentChatId, configManager.config, roleId).llmConfig;
    } catch (error) {
      logger.warn({ error }, 'Failed to resolve LLM config from config.json, using fallback');
      return { ...DEFAULT_FALLBACK_LLM_CONFIG };
    }
  }

  destroy(): void {
    SandboxEngine.activeSandboxes.delete(this.sandboxId);
    this.memory = [];

    logger.debug({ sandboxId: this.sandboxId }, 'Sandbox destroyed');
  }
}
