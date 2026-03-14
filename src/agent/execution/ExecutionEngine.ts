import type { VisionSettings } from '../../types.js';
import type { LLMProvider } from '../../providers/base.js';
import type { PluginManager } from '../../plugins/index.js';
import type { ToolRegistry, ToolContext } from '../../tools/ToolRegistry.js';
import type { AgentRoleService } from '../roles/AgentRoleService.js';
import { AgentExecutor } from './AgentExecutor.js';
import { ScopedToolRegistry } from '../../tools/ScopedToolRegistry.js';
import { logger } from '../../observability/index.js';
import type { ExecutionContext, ExecutionPolicy } from './ExecutionTypes.js';
import type { ExecutionRegistry } from './ExecutionRegistry.js';

export interface ExecutionEngineOptions {
  defaultProvider: LLMProvider;
  defaultModel: string;
  defaultSystemPrompt: string;
  maxIterations: number;
  memoryWindow: number;
  toolRegistry: ToolRegistry;
  workspace: string;
  getPluginManager: () => PluginManager | undefined;
  visionSettings?: VisionSettings;
  visionProvider?: LLMProvider;
  executionRegistry: ExecutionRegistry;
}

function buildOperationalPrompt(allowedToolNames: string[]): string {
  const sections: string[] = [];

  if (allowedToolNames.includes('send_msg_to_user')) {
    sections.push(
      [
        '沟通要求：',
        '当任务需要搜索、读取资料、调用工具、执行多个步骤或预计耗时较长时，优先使用 send_msg_to_user 向用户发送简短步骤消息。',
        '在关键阶段变化时继续用 send_msg_to_user 同步进度，例如“正在搜索资料”“正在整理大纲”“正在生成最终答案”。',
        'send_msg_to_user 不仅可用于过程进度同步，也可用于向用户发送最终任务结果；需要主动分步发送结果时，优先使用该工具。'
      ].join('\n')
    );
  }

  return sections.join('\n\n');
}

export class ExecutionEngine {
  private log = logger.child('ExecutionEngine');

  constructor(
    private options: ExecutionEngineOptions,
    private agentRoleService?: AgentRoleService
  ) {}

  updateRuntime(
    partial: Partial<Pick<ExecutionEngineOptions, 'defaultProvider' | 'defaultModel' | 'defaultSystemPrompt' | 'maxIterations' | 'memoryWindow' | 'visionSettings' | 'visionProvider'>>
  ): void {
    this.options = {
      ...this.options,
      ...partial
    };
  }

  prepare(context: ExecutionContext): {
    policy: ExecutionPolicy;
    executor: AgentExecutor;
    messages: ReturnType<AgentExecutor['buildMessages']>;
  } {
    const policy = this.resolvePolicy(context.agentName);
    const executor = this.createExecutor(policy);
    executor.setCurrentContext(context.channel, context.chatId, context.messageType);
    const messages = executor.buildMessages(
      context.history,
      context.request.content,
      context.request.media,
      context.request.files
    );

    return { policy, executor, messages };
  }

  async runSubAgentTask(
    agentName: string,
    task: string,
    toolContext: ToolContext,
    extra?: { signal?: AbortSignal; excludeTools?: string[] }
  ): Promise<string> {
    const policy = this.resolvePolicy(agentName, {
      excludeTools: extra?.excludeTools
    });
    const executor = this.createExecutor(policy);
    executor.setCurrentContext(toolContext.channel, toolContext.chatId, toolContext.messageType);
    const messages = executor.buildMessages([], task);
    const signal = extra?.signal ?? toolContext.signal;

    const initial = await executor.callLLM(messages, {
      allowTools: true,
      reasoning: policy.visionSettings?.reasoning,
      signal
    });

    if (initial.toolCalls.length === 0) {
      return initial.content;
    }

    messages.push({
      role: 'assistant',
      content: initial.content || '',
      toolCalls: initial.toolCalls
    });

    const result = await executor.executeToolLoop(messages, {
      ...toolContext,
      signal
    }, {
      agentName: policy.roleName,
      allowTools: true,
      source: 'user',
      initialToolCalls: initial.toolCalls,
      signal
    });

    return result.content;
  }

  private resolvePolicy(roleName?: string | null, extra?: { excludeTools?: string[] }): ExecutionPolicy {
    if (!this.agentRoleService) {
      const allowedToolNames = this.options.toolRegistry.getDefinitions().map((tool) => tool.name);
      return {
        roleName: 'main',
        provider: this.options.defaultProvider,
        model: this.options.defaultModel,
        systemPrompt: this.options.defaultSystemPrompt,
        skillsPrompt: buildOperationalPrompt(allowedToolNames),
        allowedToolNames,
        toolRegistryView: this.options.toolRegistry,
        visionSettings: this.options.visionSettings,
        visionProvider: this.options.visionProvider,
        maxIterations: this.options.maxIterations,
        memoryWindow: this.options.memoryWindow
      };
    }

    const resolvedRole = this.agentRoleService.getResolvedRole(roleName)
      || this.agentRoleService.getResolvedRole(this.agentRoleService.getDefaultRoleName());
    if (!resolvedRole) {
      throw new Error(`Agent role not found: ${roleName}`);
    }

    const allowedToolNames = this.agentRoleService.getAllowedToolNames(resolvedRole.name, {
      excludeTools: extra?.excludeTools
    });
    const visionSettings = this.agentRoleService.getVisionSettingsForRole(resolvedRole.name);
    const auxiliaryPrompt = [
      this.agentRoleService.buildSkillsPrompt(resolvedRole.name),
      this.agentRoleService.buildRoleDescriptionsPrompt(resolvedRole.name),
      buildOperationalPrompt(allowedToolNames)
    ].filter((section) => typeof section === 'string' && section.trim().length > 0).join('\n\n');

    return {
      roleName: resolvedRole.name,
      provider: this.agentRoleService.createProviderForRole(resolvedRole.name),
      model: resolvedRole.model,
      systemPrompt: resolvedRole.systemPrompt,
      skillsPrompt: auxiliaryPrompt,
      allowedToolNames,
      toolRegistryView: new ScopedToolRegistry(this.options.toolRegistry, allowedToolNames) as unknown as ToolRegistry,
      visionSettings,
      visionProvider: this.agentRoleService.createVisionProviderForRole(resolvedRole.name),
      maxIterations: resolvedRole.maxToolIterations,
      memoryWindow: this.options.memoryWindow
    };
  }

  private createExecutor(policy: ExecutionPolicy): AgentExecutor {
    this.log.debug(`Creating executor for role=${policy.roleName}, model=${policy.model}`);

    return new AgentExecutor(
      policy.provider,
      policy.toolRegistryView as ToolRegistry,
      this.options.workspace,
      policy.systemPrompt,
      policy.skillsPrompt,
      policy.model,
      policy.maxIterations,
      this.options.getPluginManager(),
      policy.visionSettings,
      policy.visionProvider,
      this.options.executionRegistry
    );
  }
}
