import type { RoleConfig, Message, SessionKey, Skill } from '@aesyclaw/core/types';
import { getMessageText } from '@aesyclaw/core/types';
import type { AgentMessage, ResolvedModel, AgentTool } from './agent-types';
import { createPersistedAssistantMessage, createUserMessage } from './agent-types';
import type { AesyClawTool, ToolExecutionContext, ToolRegistry } from '@aesyclaw/tool/tool-registry';
import type { LlmAdapter } from './llm-adapter';
import { estimateApproximateTokens, type Session } from '@aesyclaw/session';
import type { RoleManager } from '@aesyclaw/role/role-manager';
import type { SkillManager } from '@aesyclaw/skill/skill-manager';
import type { HookDispatcher } from '@aesyclaw/pipeline/hook-dispatcher';
import { createScopedLogger } from '@aesyclaw/core/logger';
import type { AgentRegistry } from './agent-registry';
import { runWorkerTask } from './worker-runner';

const logger = createScopedLogger('agent');

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

type RunTurnResult = {
  newMessages: AgentMessage[];
  lastAssistant: string | null;
};

type BuildPromptResult = {
  prompt: string;
  tools: AgentTool[];
};

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

  get model(): ResolvedModel {
    return this._model;
  }

  get allowedTools(): AesyClawTool[] {
    return this._allowedTools;
  }

  get activeRole(): RoleConfig | null {
    return this._activeRole;
  }

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

  async process(
    message: Message,
    sendMessage?: (message: Message) => Promise<boolean>,
  ): Promise<Message> {
    const role = this._activeRole;
    if (!role) {
      return { components: [{ type: 'Plain', text: '[错误: 无可用角色]' }] };
    }

    const content = getMessageText(message);

    logger.debug('正在处理消息', {
      sessionKey: this.session.key,
      role: role.id,
      contentLength: content.length,
    });

    let history = this.session.get();
    if (this.shouldCompact(history)) {
      await this.session.compact(this.llmAdapter, role.model);
      history = this.session.get();
    }

    const result = await this.runTurn(
      role,
      content,
      history as AgentMessage[],
      this.session.key,
      sendMessage,
    );
    await this.session.syncFromAgent(result.newMessages);

    return this.toMessage(role.id, result);
  }

  async processEphemeral(role: RoleConfig, content: string): Promise<Message> {
    const ephemeralRole: RoleConfig = {
      ...role,
      toolPermission: { mode: 'allowlist', list: [] },
    };
    const history = this.session.get() as AgentMessage[];
    const result = await this.runTurn(ephemeralRole, content, history, this.session.key);
    return this.toMessage(role.id, result);
  }

  async runTurn(
    role: RoleConfig,
    content: string,
    history: AgentMessage[],
    sessionKey: SessionKey,
    sendMessage?: (message: Message) => Promise<boolean>,
  ): Promise<RunTurnResult> {
    const executionContext: Partial<ToolExecutionContext> = {
      sessionKey,
      sendMessage,
      toolPermission: role.toolPermission,
      addToHistory: async (role, text) => {
        const msg =
          role === 'user'
            ? createUserMessage(text)
            : createPersistedAssistantMessage(text);
        await this.session.add(msg);
      },
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

    const prompt = this.assemblePrompt(role, resolvedTools.tools, skills, allRoles);

    return { prompt, tools: resolvedTools.agentTools };
  }

  private assemblePrompt(
    role: RoleConfig,
    availableTools: AesyClawTool[],
    skills: Skill[],
    allRoles: RoleConfig[],
  ): string {
    const sections: string[] = [this.replaceTemplateVariables(role.systemPrompt)];

    if (availableTools.length > 0) {
      sections.push(this.buildToolSection(availableTools));
    }

    if (skills.length > 0) {
      const skillLines = skills.map((skill) => `## Skill: ${skill.name}\n${skill.content}`);
      sections.push(skillLines.join('\n\n'));
    }

    if (allRoles.length > 0) {
      const roleLines = allRoles.map((r) => `- **${r.id}** — ${r.description}`);
      sections.push(`## Available Roles\n${roleLines.join('\n')}`);
    }

    return sections.join('\n\n');
  }

  private replaceTemplateVariables(template: string): string {
    return template
      .replace(/\{\{date}}/g, new Date().toISOString().split('T')[0] ?? '')
      .replace(/\{\{os}}/g, process.platform)
      .replace(/\{\{systemLang}}/g, process.env['LANG'] ?? 'unknown');
  }

  private buildToolSection(tools: AesyClawTool[]): string {
    const toolLines = tools.map((tool) => `- **${tool.name}**: ${tool.description}`);
    return `## Available Tools\n${toolLines.join('\n')}`;
  }

  private toMessage(roleId: string, result: RunTurnResult): Message {
    if (result.lastAssistant) {
      return { components: [{ type: 'Plain', text: result.lastAssistant }] };
    }
    logger.warn('Agent 未生成助手文本回复', { role: roleId });
    return { components: [{ type: 'Plain', text: '[未生成回复]' }] };
  }

  private shouldCompact(messages: readonly AgentMessage[]): boolean {
    return estimateApproximateTokens(messages) >= this._model.contextWindow * this.compressionThreshold;
  }
}
