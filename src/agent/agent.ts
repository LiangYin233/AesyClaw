import type { RoleConfig, Message, SessionKey } from '@aesyclaw/core/types';
import { getMessageText } from '@aesyclaw/core/types';
import type { AgentMessage, ResolvedModel, AgentTool } from './agent-types';
import type {
  AesyClawTool,
  ToolExecutionContext,
  ToolRegistry,
} from '@aesyclaw/tool/tool-registry';
import type { LlmAdapter } from './llm-adapter';
import { estimateApproximateTokens, type Session } from '@aesyclaw/session';
import type { RoleManager } from '@aesyclaw/role/role-manager';
import type { SkillManager } from '@aesyclaw/skill/skill-manager';
import type { HookDispatcher } from '@aesyclaw/pipeline/hook-dispatcher';
import { createScopedLogger } from '@aesyclaw/core/logger';
import type { AgentRegistry } from './agent-registry';
import { runAgentTask } from './runner/agent-runner';
import { buildAgentPrompt } from './agent-prompt';

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

type ProcessOptions = {
  ephemeral?: boolean;
  role?: RoleConfig;
};

type ProcessContext = {
  role: RoleConfig;
  effectiveRole: RoleConfig;
  ephemeral: boolean;
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

  private _cachedSystemPrompt: string | null = null;

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
    this._cachedSystemPrompt = null;
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
    options?: ProcessOptions,
  ): Promise<Message> {
    const context = this.createProcessContext(options);
    if (!context) {
      return { components: [{ type: 'Plain', text: '[错误: 无可用角色]' }] };
    }
    const { role, effectiveRole, ephemeral } = context;

    const content = getMessageText(message);

    logger.debug('正在处理消息', {
      sessionKey: this.session.key,
      role: role.id,
      contentLength: content.length,
      ephemeral,
    });

    const history = await this.loadHistory(role, ephemeral);

    const result = await this.callLLM(
      effectiveRole,
      content,
      history,
      this.session.key,
      ephemeral ? undefined : sendMessage,
    );

    const finalResult = ephemeral
      ? result
      : await this.ensureAssistantText(effectiveRole, history, result, sendMessage);

    if (!ephemeral) {
      await this.session.syncFromAgent(finalResult.newMessages);
    }

    return this.toMessage(effectiveRole.id, finalResult);
  }

  /**
   * 调用 LLM，异步执行提示循环。
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

    const { prompt: builtPrompt, tools } = this.buildPrompt(role, executionContext);
    const prompt = this._cachedSystemPrompt ?? builtPrompt;
    this._cachedSystemPrompt ??= builtPrompt;
    const model = this.llmAdapter.resolveModel(role.model);

    const contentWithDate = `Current date: ${new Date().toISOString().split('T')[0] ?? 'unknown'}\n\n${content}`;

    return await runAgentTask({
      roleId: role.id,
      model,
      prompt,
      tools,
      history,
      content: contentWithDate,
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
    const skills = this.skillManager.getSkillsForRole(role);
    const resolvedTools = this.toolRegistry.resolveForRole(
      role,
      this.hookDispatcher,
      executionContext ?? {},
    );
    const prompt = buildAgentPrompt({
      role,
      availableTools: resolvedTools.tools,
      skills,
      allRoles,
      skillDirs: this.skillManager.getSkillDirs(),
      isSubAgent: executionContext !== undefined && executionContext.sendMessage === undefined,
      isCron: executionContext?.sessionKey?.channel === 'cron',
    });

    return { prompt, tools: resolvedTools.agentTools };
  }

  private createProcessContext(options?: ProcessOptions): ProcessContext | null {
    const ephemeral = options?.ephemeral === true;
    const role = ephemeral ? options?.role : this._activeRole;
    if (!role) return null;

    return {
      role,
      effectiveRole: ephemeral
        ? { ...role, toolPermission: { mode: 'allowlist' as const, list: [] } }
        : role,
      ephemeral,
    };
  }

  private async loadHistory(role: RoleConfig, ephemeral: boolean): Promise<AgentMessage[]> {
    let history = this.session.get();
    if (!ephemeral && this.shouldCompact(history)) {
      await this.session.compact(this.llmAdapter, role.model);
      history = this.session.get();
    }
    return history as AgentMessage[];
  }

  private async ensureAssistantText(
    role: RoleConfig,
    history: AgentMessage[],
    result: CallLLMResult,
    sendMessage?: (message: Message) => Promise<boolean>,
  ): Promise<CallLLMResult> {
    if (result.lastAssistant) return result;

    const combinedHistory = history.concat(result.newMessages);
    let followUpHistory = combinedHistory;

    if (estimateApproximateTokens(combinedHistory) >= this.compressionThreshold * this._model.contextWindow) {
      logger.info('Agent 追加文本前压缩上下文', {
        role: role.id,
        estimatedTokens: estimateApproximateTokens(combinedHistory),
        contextWindow: this._model.contextWindow,
      });
      await this.session.compact(this.llmAdapter, role.model);
      followUpHistory = [...this.session.get()].concat(result.newMessages);
    }

    logger.info('Agent 未产出文本回复，追加提示要求必须生成文本', { role: role.id });
    const followUpResult = await this.callLLM(
      role,
      '请根据以上工具调用结果生成回复文本，不要调用工具。',
      followUpHistory,
      this.session.key,
      sendMessage,
    );

    return {
      newMessages: result.newMessages.concat(followUpResult.newMessages),
      lastAssistant: followUpResult.lastAssistant,
    };
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
    return (
      estimateApproximateTokens(messages) >= this._model.contextWindow * this.compressionThreshold
    );
  }
}
