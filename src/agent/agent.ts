import type { RoleConfig, Message, SessionKey, Skill } from '@aesyclaw/core/types';
import { getMessageText } from '@aesyclaw/core/types';
import type { AgentMessage, ResolvedModel, AgentTool } from './agent-types';
import type { AesyClawTool, ToolExecutionContext, ToolRegistry } from '@aesyclaw/tool/tool-registry';
import type { LlmAdapter } from './llm-adapter';
import { estimateApproximateTokens, type Session } from '@aesyclaw/session';
import type { RoleManager } from '@aesyclaw/role/role-manager';
import type { SkillManager } from '@aesyclaw/skill/skill-manager';
import type { HookDispatcher } from '@aesyclaw/pipeline/hook-dispatcher';
import { createScopedLogger } from '@aesyclaw/core/logger';
import type { AgentRegistry } from './agent-registry';
import { runWorkerTask } from './runner/agent-worker-host';
import { buildRoleSection, buildSkillSection } from './prompt-sections';

const logger = createScopedLogger('agent');

/**
 * Agent 构造选项。
 */
export type AgentOptions = {
  session: Session;
  llmAdapter: LlmAdapter;
  roleManager: RoleManager;
  skillManager: SkillManager;
  toolRegistry: ToolRegistry;
  hookDispatcher: HookDispatcher;
  compressionThreshold: number;
  registry: AgentRegistry;
};

/**
 * callLLM 的返回结果。
 */
type CallLLMResult = {
  newMessages: AgentMessage[];
  lastAssistant: string | null;
};

/**
 * buildPrompt 的返回结果。
 */
type BuildPromptResult = {
  prompt: string;
  tools: AgentTool[];
};

/**
 * Agent 核心类，承担消息处理、LLM 调用和 Prompt 构建的职责。
 */
export class Agent {
  readonly session: Session;
  roleId?: string;

  private compressionThreshold: number;

  private _model!: ResolvedModel;
  private _activeRole: RoleConfig | null = null;
  private _allowedTools: AesyClawTool[] = [];

  private llmAdapter: LlmAdapter;
  private roleManager: RoleManager;
  private skillManager: SkillManager;
  private toolRegistry: ToolRegistry;
  private hookDispatcher: HookDispatcher;
  private registry: AgentRegistry;

  /**
   * @param options - Agent 构造选项
   */
  constructor(options: AgentOptions) {
    this.session = options.session;
    this.llmAdapter = options.llmAdapter;
    this.roleManager = options.roleManager;
    this.skillManager = options.skillManager;
    this.toolRegistry = options.toolRegistry;
    this.hookDispatcher = options.hookDispatcher;
    this.compressionThreshold = options.compressionThreshold;
    this.registry = options.registry;

    this.registry.registerAgent(this.session.key, this);
  }

  /** 当前解析后的模型配置 */
  get model(): ResolvedModel {
    return this._model;
  }

  /** 当前角色允许使用的工具列表 */
  get allowedTools(): AesyClawTool[] {
    return this._allowedTools;
  }

  /** 当前激活的角色配置 */
  get activeRole(): RoleConfig | null {
    return this._activeRole;
  }

  /**
   * 设置当前使用的模型。
   *
   * @param modelId - 模型标识符，例如 "openai/gpt-4o"
   */
  setModel(modelId: string): void {
    this._model = this.llmAdapter.resolveModel(modelId);
    logger.info('模型已切换', {
      provider: this._model.provider,
      modelId: this._model.modelId,
    });
  }

  async setRole(role: RoleConfig): Promise<void> {
    this._activeRole = role;

    this._allowedTools = this.toolRegistry.getForRole(role);

    this._model = this.llmAdapter.resolveModel(role.model);

    this.roleId = role.id;
  }

  /**
   * 处理用户消息，调用 LLM 并返回回复。
   *
   * @param message - 用户消息
   * @param sendMessage - 可选的发消息回调
   * @param options - 可选配置（ephemeral 标记、临时角色）
   * @returns Agent 回复消息
   */
  async process(
    message: Message,
    sendMessage?: (message: Message) => Promise<boolean>,
    options?: { ephemeral?: boolean; role?: RoleConfig },
  ): Promise<Message> {
    const role = options?.ephemeral ? options?.role : this._activeRole;
    if (!role) {
      return { components: [{ type: 'Plain', text: '[错误: 无可用角色]' }] };
    }

    const content = getMessageText(message);

    logger.debug('正在处理消息', {
      sessionKey: this.session.key,
      role: role.id,
      contentLength: content.length,
      ephemeral: !!options?.ephemeral,
    });

    let history = this.session.get();
    if (!options?.ephemeral && this.shouldCompact(history)) {
      await this.session.compact(this.llmAdapter, role.model);
      history = this.session.get();
    }

    const effectiveRole = options?.ephemeral
      ? { ...role, toolPermission: { mode: 'allowlist' as const, list: [] } }
      : role;

    const result = await this.callLLM(
      effectiveRole,
      content,
      history as AgentMessage[],
      this.session.key,
      options?.ephemeral ? undefined : sendMessage,
    );

    // 若 LLM 只产出了工具调用而无文本回复，追加提示要求生成文本（最多重试一次）
    if (!result.lastAssistant && !options?.ephemeral) {
      logger.info('Agent 未产出文本回复，追加提示要求必须生成文本', { role: effectiveRole.id });
      const updatedHistory = history.concat(result.newMessages) as AgentMessage[];
      const followUpResult = await this.callLLM(
        effectiveRole,
        '请根据以上工具调用结果生成回复文本，不要调用工具。',
        updatedHistory,
        this.session.key,
        sendMessage,
      );
      result.newMessages = result.newMessages.concat(followUpResult.newMessages);
      result.lastAssistant = followUpResult.lastAssistant;
    }

    if (!options?.ephemeral) {
      await this.session.syncFromAgent(result.newMessages);
    }

    return this.toMessage(effectiveRole.id, result);
  }

  /**
   * 调用 LLM，在 Worker 线程中执行提示循环。
   *
   * @param role - 角色配置
   * @param content - 用户输入文本
   * @param history - 历史消息
   * @param sessionKey - 会话标识
   * @param sendMessage - 可选的发消息回调
   * @returns LLM 调用结果
   */
  async callLLM(
    role: RoleConfig,
    content: string,
    history: AgentMessage[],
    sessionKey: SessionKey,
    sendMessage?: (message: Message) => Promise<boolean>,
  ): Promise<CallLLMResult> {
    const executionContext: Partial<ToolExecutionContext> = {
      sessionKey,
      sendMessage,
      toolPermission: role.toolPermission,
    };

    const { prompt, tools } = this.buildPrompt(role, executionContext);
    const model = this.llmAdapter.resolveModel(role.model);

    return await runWorkerTask({
      roleId: role.id,
      model,
      prompt,
      tools,
      history,
      content,
      sessionKey,
      compressionThreshold: this.compressionThreshold,
      registry: this.registry,
    });
  }

  /**
   * 构建发送给 LLM 的完整 Prompt，包含系统提示、工具列表、技能和角色信息。
   *
   * @param role - 角色配置
   * @param executionContext - 可选的工具执行上下文
   * @returns Prompt 文本和工具列表
   */
  buildPrompt(
    role: RoleConfig,
    executionContext?: Partial<ToolExecutionContext>,
  ): BuildPromptResult {
    const allRoles = this.roleManager.getEnabledRoles();
    const skills: Skill[] = this.skillManager.getSkillsForRole(role);

    const resolvedTools = this.toolRegistry.resolveForRole(
      role,
      this.hookDispatcher,
      executionContext ?? {},
    );

    const isSubAgent = executionContext !== undefined && executionContext.sendMessage === undefined;
    const isCron = executionContext?.sessionKey?.channel === 'cron';
    const prompt = this.assemblePrompt(role, resolvedTools.tools, skills, allRoles, isSubAgent, isCron);

    return { prompt, tools: resolvedTools.agentTools };
  }

  /**
   * 组装完整的系统 Prompt。
   *
   * @param role - 角色配置
   * @param availableTools - 可用工具列表
   * @param skills - 可用技能列表
   * @param allRoles - 所有已启用的角色
   * @param isSubAgent - 是否为子 Agent（子 Agent 不注入角色切换指令）
   * @param isCron - 是否为定时任务（定时任务不注入 send_msg 使用提示）
   * @returns 拼接后的完整 Prompt 字符串
   */
  private assemblePrompt(
    role: RoleConfig,
    availableTools: AesyClawTool[],
    skills: Skill[],
    allRoles: RoleConfig[],
    isSubAgent: boolean,
    isCron: boolean,
  ): string {
    const sections: string[] = [this.replaceTemplateVariables(role.systemPrompt)];

    if (availableTools.length > 0) {
      sections.push(this.buildToolSection(availableTools));
    }

    if (skills.length > 0) {
      sections.push(buildSkillSection(skills, this.skillManager.getSkillDirs()));
    }

    if (!isSubAgent && !isCron) {
      sections.push(
        '## 用户沟通\n在任务执行过程中，如果需要向用户说明当前正在进行的步骤或进度，可使用 send_msg 工具发送消息给用户。',
      );
    }

    if (allRoles.length > 0 && !isSubAgent) {
      sections.push(buildRoleSection(allRoles));
    }

    return sections.join('\n\n');
  }

  /**
   * 替换 Prompt 模板中的占位变量。
   *
   * @param template - 包含 {{date}}、{{os}}、{{systemLang}} 占位符的模板字符串
   * @returns 替换后的字符串
   */
  private replaceTemplateVariables(template: string): string {
    return template
      .replace(/\{\{date}}/g, new Date().toISOString().split('T')[0] ?? '')
      .replace(/\{\{os}}/g, process.platform)
      .replace(/\{\{systemLang}}/g, process.env['LANG'] ?? 'unknown');
  }

  /**
   * 构建工具列表的 Markdown 描述段落。
   *
   * @param tools - 可用工具列表
   * @returns Markdown 格式的工具描述段落
   */
  private buildToolSection(tools: AesyClawTool[]): string {
    const toolLines = tools.map((tool) => `- **${tool.name}**: ${tool.description}`);
    return `## Available Tools\n${toolLines.join('\n')}`;
  }

  /**
   * 将 LLM 调用结果转换为用户可见的 Message。
   *
   * @param roleId - 角色标识
   * @param result - LLM 调用结果
   * @returns 包含文本组件的 Message
   */
  private toMessage(roleId: string, result: CallLLMResult): Message {
    if (result.lastAssistant) {
      return { components: [{ type: 'Plain', text: result.lastAssistant }] };
    }
    logger.warn('Agent 未生成助手文本回复', { role: roleId });
    return { components: [{ type: 'Plain', text: '[未生成回复]' }] };
  }

  /**
   * 判断消息历史是否超过压缩阈值，需要触发历史压缩。
   *
   * @param messages - 消息历史
   * @returns 如果超过阈值返回 true
   */
  private shouldCompact(messages: readonly AgentMessage[]): boolean {
    return estimateApproximateTokens(messages) >= this._model.contextWindow * this.compressionThreshold;
  }
}
