import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import type {
  RoleConfig,
  Message,
  SessionKey,
  Skill,
} from '@aesyclaw/core/types';
import { serializeSessionKey, getMessageText } from '@aesyclaw/core/types';
import type { AgentMessage, ResolvedModel, AgentTool } from './agent-types';
import { extractMessageText } from './agent-types';
import type { AesyClawTool, ToolExecutionContext } from '@aesyclaw/tool/tool-registry';
import type { LlmAdapter } from './llm-adapter';
import type { Session } from '@aesyclaw/session';
import type { ToolRegistry } from '@aesyclaw/tool/tool-registry';
import type { RoleManager } from '@aesyclaw/role/role-manager';
import type { SkillManager } from '@aesyclaw/skill/skill-manager';
import type { HookDispatcher } from '@aesyclaw/pipeline/hook-dispatcher';
import { buildSkillPromptSection } from '@aesyclaw/skill/skill-prompt';
import { createScopedLogger } from '@aesyclaw/core/logger';

const logger = createScopedLogger('agent');
const WORKER_PATH = fileURLToPath(new URL('./runner/agent-worker.ts', import.meta.url));

export type AgentOptions = {
  session: Session;
  llmAdapter: LlmAdapter;
  roleManager: RoleManager;
  skillManager: SkillManager;
  toolRegistry: ToolRegistry;
  hookDispatcher: HookDispatcher;
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
  static activeAgents = new Map<string, Agent>();
  private static activeWorkers = new Map<string, Worker>();

  readonly session: Session;
  roleId?: string;

  private _model!: ResolvedModel;
  private _activeRole: RoleConfig | null = null;
  private _allowedTools: AesyClawTool[] = [];

  private llmAdapter: LlmAdapter;
  private roleManager: RoleManager;
  private skillManager: SkillManager;
  private toolRegistry: ToolRegistry;
  private hookDispatcher: HookDispatcher;

  constructor(options: AgentOptions) {
    this.session = options.session;
    this.llmAdapter = options.llmAdapter;
    this.roleManager = options.roleManager;
    this.skillManager = options.skillManager;
    this.toolRegistry = options.toolRegistry;
    this.hookDispatcher = options.hookDispatcher;

    Agent.activeAgents.set(serializeSessionKey(this.session.key), this);
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
    };

    const { prompt, tools } = this.buildPrompt(role, executionContext);
    const model = this.llmAdapter.resolveModel(role.model);

    const toolMap = new Map(tools.map((t) => [t.name, t]));
    const worker = new Worker(WORKER_PATH);
    const key = serializeSessionKey(sessionKey);
    void Agent.activeWorkers.get(key)?.terminate();
    Agent.activeWorkers.set(key, worker);
    const timeout = setTimeout(() => void worker.terminate(), 120_000);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let onMessage: ((msg: any) => void) | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let onError: ((err: any) => void) | undefined;
    let onExit: ((code: number) => void) | undefined;
    let settled = false;

    try {
      const workerResult = await new Promise<RunTurnResult>((resolve, reject) => {
        onError = (err: Error) => {
          settled = true;
          cleanup();
          reject(new Error(`Worker 错误: ${err.message}`));
        };
        onExit = (code: number) => {
          if (settled || code === 0) return;
          settled = true;
          cleanup();
          reject(new Error('Agent 处理已中止'));
        };
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        onMessage = async (msg: Record<string, unknown>) => {
          if (msg['type'] === 'done') {
            settled = true;
            cleanup();
            resolve({
              newMessages: msg['newMessages'] as AgentMessage[],
              lastAssistant: msg['lastAssistant'] as string | null,
            });
          } else if (msg['type'] === 'toolCall') {
            const tool = toolMap.get(msg['toolName'] as string);
            if (!tool) {
              worker.postMessage({
                type: 'toolResult',
                callId: msg['callId'],
                error: `工具 "${msg['toolName'] as string}" 未找到`,
              });
              return;
            }
            try {
              const toolResult = await tool.execute(msg['toolCallId'] as string, msg['params']);
              if (toolResult.isError) {
                const errorContent =
                  typeof toolResult.content === 'string'
                    ? toolResult.content
                    : JSON.stringify(toolResult.content);
                logger.error('工具调用返回错误', {
                  toolName: msg['toolName'],
                  error: errorContent,
                });
                worker.postMessage({
                  type: 'toolResult',
                  callId: msg['callId'],
                  error: errorContent,
                  isError: true,
                });
              } else {
                worker.postMessage({
                  type: 'toolResult',
                  callId: msg['callId'],
                  result: toolResult,
                });
              }
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              logger.error('工具调用执行失败', {
                toolName: msg['toolName'],
                error: errMsg,
              });
              worker.postMessage({
                type: 'toolResult',
                callId: msg['callId'],
                error: errMsg,
              });
            }
          } else if (msg['type'] === 'fatal') {
            settled = true;
            cleanup();
            reject(new Error(msg['message'] as string));
          }
        };

        worker.on('message', onMessage);
        worker.on('error', onError);
        worker.on('exit', onExit);

        worker.postMessage({
          type: 'init',
          systemPrompt: prompt,
          model,
          apiKey: model.apiKey,
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
          history,
          content,
          extraBody: model.extraBody,
          sessionId: `worker:${role.id}:${Date.now()}`,
        });
      });

      return workerResult;
    } finally {
      cleanup();
    }

    function cleanup(): void {
      clearTimeout(timeout);
      if (onMessage) worker.off('message', onMessage);
      if (onError) worker.off('error', onError);
      if (onExit) worker.off('exit', onExit);
      if (Agent.activeWorkers.get(key) === worker) {
        Agent.activeWorkers.delete(key);
      }
      void worker.terminate();
    }
  }

  cancel(): void {
    const key = serializeSessionKey(this.session.key);
    const worker = Agent.activeWorkers.get(key);
    if (worker) {
      Agent.activeWorkers.delete(key);
      void worker.terminate();
      logger.info('Agent worker 已取消', { sessionKey: this.session.key });
    }
  }

  static cancel(sessionKey: SessionKey): boolean {
    const agent = Agent.activeAgents.get(serializeSessionKey(sessionKey));
    if (!agent) return false;
    agent.cancel();
    return true;
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
    let prompt = this.replaceTemplateVariables(role.systemPrompt);

    if (availableTools.length > 0) {
      prompt += `\n\n${this.buildToolSection(availableTools)}`;
    }

    if (skills.length > 0) {
      prompt += `\n\n${buildSkillPromptSection(skills)}`;
    }

    if (allRoles.length > 0) {
      const roleLines = allRoles.map((r) => `- **${r.id}** — ${r.description}`);
      prompt += `\n\n## Available Roles\n${roleLines.join('\n')}`;
    }

    return prompt;
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
    const threshold = 1000;
    const textLength = messages.reduce((total, m) => total + extractMessageText(m).length, 0);
    return Math.ceil(textLength / 4) >= threshold;
  }
}
