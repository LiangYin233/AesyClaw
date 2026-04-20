/** @file 子代理沙箱引擎
 *
 * SandboxEngine 为子代理（SubAgent）提供隔离的执行环境：
 * - 独立的记忆空间（不与父会话共享）
 * - 受限的工具集（通过 allowedTools 过滤，禁止递归调用 subagent 工具）
 * - 独立的 AgentEngine 实例，支持多步工具调用
 *
 * 沙箱初始化时会构建系统提示词，包含：
 * - 角色系统提示词（或临时提示词）
 * - 工具权限说明
 * - 沙箱限制说明（禁止调用 subagent 工具）
 * - 任务描述
 */

import { randomUUID } from 'crypto';
import {
  type AgentSkill,
  type Message as AesyiuMessage,
} from 'aesyiu';
import { prepareAgentRun } from '@/agent/runtime/prepare-agent-run.js';
import {
  buildAesyiuEngine,
  type AesyiuRunStats,
  getFinalAssistantText,
} from '@/agent/runtime/aesyiu-runtime-helpers.js';
import type { PluginHookRuntime } from '@/contracts/plugin-hook-runtime.js';
import type { ConfigSource, RoleStore, SkillStore } from '@/contracts/runtime-services.js';
import { DEFAULT_ROLE_ID } from '@/features/roles/types.js';
import { type LLMConfig } from '@/platform/llm/types.js';
import { logger } from '@/platform/observability/logger.js';
import { toErrorMessage } from '@/platform/utils/errors.js';
import type { ToolCatalog } from '@/platform/tools/registry.js';
import { Tool, ToolExecuteContext } from '@/platform/tools/types.js';
import { DEFAULT_FALLBACK_LLM_CONFIG } from '@/agent/runtime/resolve-llm-config.js';
import {
  SUBAGENT_TOOL_NAME_RUN,
  SUBAGENT_TOOL_NAME_TEMP,
  type SandboxConfig,
  type SubAgentResult,
} from './types.js';

/** 子代理沙箱引擎
 *
 * 为子代理提供隔离的执行环境，限制工具集并禁止递归调用 subagent 工具。
 */
export class SandboxEngine {
  private sandboxId: string;
  private parentChatId: string;
  private config: SandboxConfig;
  private agentId: string;
  private memory: AesyiuMessage[] = [];
  private maxSteps: number = 10;
  private readonly toolCatalog: ToolCatalog;
  private readonly hookRuntime: PluginHookRuntime;
  private readonly configSource: ConfigSource;
  private readonly roleStore: RoleStore;
  private readonly skillStore: SkillStore;

  /** 沙箱中禁止使用的工具（防止递归调用 subagent） */
  private static readonly DISALLOWED_SANDBOX_TOOLS = new Set([
    SUBAGENT_TOOL_NAME_RUN,
    SUBAGENT_TOOL_NAME_TEMP,
  ]);

  constructor(
    parentChatId: string,
    config: SandboxConfig,
    deps: {
      toolCatalog: ToolCatalog;
      hookRuntime: PluginHookRuntime;
      configSource: ConfigSource;
      roleStore: RoleStore;
      skillStore: SkillStore;
    }
  ) {
    this.sandboxId = `sandbox_${parentChatId}_${randomUUID()}`;
    this.parentChatId = parentChatId;
    this.config = config;
    this.agentId = `subagent_${this.sandboxId}`;
    this.toolCatalog = deps.toolCatalog;
    this.hookRuntime = deps.hookRuntime;
    this.configSource = deps.configSource;
    this.roleStore = deps.roleStore;
    this.skillStore = deps.skillStore;

    this.initializeMemory();

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

  /** 初始化沙箱记忆，构建系统提示词 */
  private initializeMemory(): void {
    const toolPermissionText = this.config.allowedTools.includes('*')
      ? '你有权限使用所有工具。'
      : `你只能使用以下工具: ${this.config.allowedTools.join(', ')}。`;
    const sandboxRestrictionText = '你当前运行在子代理沙箱中，禁止再次调用任何 subagent 工具。';

    const taskDescription = this.getTaskFromConfig();
    const fullSystemPrompt = `${this.config.systemPrompt}\n\n${toolPermissionText}\n${sandboxRestrictionText}\n\n任务：${taskDescription}`;

    this.memory = [
      {
        role: 'system',
        content: fullSystemPrompt,
      },
    ];
  }

  /** 从配置中提取任务描述 */
  private getTaskFromConfig(): string {
    if (this.config.roleId) {
      const role = this.roleStore.getRole(this.config.roleId);
      return role?.name
        ? `你当前扮演的是【${role.name}】角色。\n\n任务要求：\n${this.extractTaskDescription()}`
        : this.extractTaskDescription();
    }
    return this.extractTaskDescription();
  }

  /** 从系统提示词中提取任务描述 */
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

  /** 获取沙箱允许使用的工具（过滤掉禁止的工具） */
  private getFilteredTools(): Tool[] {
    const allTools = this.toolCatalog.getAllToolDefinitions();
    const allowedNames = this.config.allowedTools.includes('*')
      ? allTools.map(tool => tool.name)
      : allTools.filter(tool => this.config.allowedTools.includes(tool.name)).map(tool => tool.name);

    return allowedNames
      .filter(toolName => !SandboxEngine.DISALLOWED_SANDBOX_TOOLS.has(toolName))
      .map(toolName => this.toolCatalog.getTool(toolName))
      .filter((tool): tool is Tool => Boolean(tool));
  }

  /** 获取沙箱允许使用的技能 */
  private getAllowedSkills(): AgentSkill[] {
    if (!this.skillStore.isInitialized()) return [];
    return this.skillStore.getSkillsForRole(this.config.allowedSkills);
  }

  /** 执行子代理任务
   *
   * 构建独立的 AgentEngine，执行多步工具调用循环，
   * 返回执行结果。执行完成后自动销毁沙箱。
   */
  async execute(): Promise<SubAgentResult> {
    const startTime = Date.now();

    logger.info(
      { sandboxId: this.sandboxId },
      'Starting sub-agent execution'
    );

    try {
      const filteredTools = this.getFilteredTools();
      const allowedSkills = this.getAllowedSkills();
      const llmConfig = this.getLLMConfig();
      const stats: AesyiuRunStats = { steps: 0, toolCalls: 0 };

      const { engine, context } = buildAesyiuEngine({
        chatId: this.agentId,
        llmConfig,
        providers: this.configSource.getConfig().providers,
        maxContextTokens: this.configSource.getConfig().memory.max_context_tokens,
        compressionThreshold: this.configSource.getConfig().memory.compression_threshold,
        maxSteps: this.maxSteps,
        filteredTools,
        allowedSkills,
        messages: this.memory,
        stats,
        hookRuntime: this.hookRuntime,
        createToolContext: (ctx): ToolExecuteContext => ({
          roleId: this.config.roleId,
          allowedTools: this.config.allowedTools,
          allowedSkills: this.config.allowedSkills,
          chatId: this.agentId,
          senderId: 'subagent',
          agentContext: ctx,
        }),
        checkToolAllowed: (tool) => {
          if (!this.config.allowedTools.includes('*') && !this.config.allowedTools.includes(tool.name)) {
            return { success: false, content: '', error: `工具 "${tool.name}" 不在允许列表中` };
          }
          return null;
        },
        getRoleId: () => this.config.roleId ?? '',
      });

      const result = await engine.run(
        {
          role: 'user',
          content: this.extractTaskDescription(),
        },
        context
      );

      this.memory = [...result.visibleMessages];

      let lastAssistantMessage = getFinalAssistantText(result.visibleMessages);
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
      const errorMessage = toErrorMessage(error);

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

  /** 获取 LLM 配置（优先从角色配置解析，失败时使用回退配置） */
  private getLLMConfig(): LLMConfig {
    try {
      const roleId = this.config.roleId || DEFAULT_ROLE_ID;
      return prepareAgentRun(this.parentChatId, this.configSource.getConfig(), {
        buildSystemPrompt: () => this.config.systemPrompt,
      }, this.roleStore, roleId).llmConfig;
    } catch (error) {
      logger.warn({ error }, 'Failed to resolve LLM config from config.json, using fallback');
      return { ...DEFAULT_FALLBACK_LLM_CONFIG };
    }
  }

  /** 销毁沙箱，释放记忆 */
  destroy(): void {
    this.memory = [];

    logger.debug({ sandboxId: this.sandboxId }, 'Sandbox destroyed');
  }
}
