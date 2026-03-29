import type { VisionSettings } from '../../../types.js';
import type { LLMProvider } from '../../../platform/providers/base.js';
import { resolveExecutionModel } from '../../../platform/utils/modelRef.js';
import type { ToolRegistry, ToolContext } from '../../../platform/tools/ToolRegistry.js';
import type { AgentRoleService } from '../../../platform/context/AgentContext.js';
import type { PluginManager } from '../../../platform/context/PluginContext.js';
import { AgentExecutor } from './AgentExecutor.js';
import { ScopedToolRegistry } from '../../../platform/tools/ScopedToolRegistry.js';
import type { ExecutionContext, ExecutionPolicy } from './ExecutionTypes.js';
import type { ExecutionRegistry } from './ExecutionRegistry.js';

export interface ExecutionEngineOptions {
  defaultProvider?: LLMProvider;
  mainModel?: string;
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
        '当任务涉及工具、多个步骤或耗时较长时，用 send_msg_to_user 向用户简短同步进度；需要主动分步发送结果时，也优先使用它。'
      ].join('\n')
    );
  }

  if (allowedToolNames.includes('memory_list')) {
    sections.push(
      [
        '长期记忆要求：',
        '当任务涉及用户偏好、长期背景、既有约定或历史决策时，先用 memory_list 查询；确认新的长期信息后，再用 memory_manage 更新。一次性任务和短期上下文不要写入长期记忆。'
      ].join('\n')
    );
  }

  return sections.join('\n\n');
}

export class ExecutionEngine {
  constructor(
    private options: ExecutionEngineOptions,
    private agentRoleService?: AgentRoleService
  ) {}

  updateRuntime(
    partial: Partial<Pick<ExecutionEngineOptions, 'defaultProvider' | 'mainModel' | 'defaultSystemPrompt' | 'maxIterations' | 'memoryWindow' | 'visionSettings' | 'visionProvider'>>
  ): void {
    this.options = {
      ...this.options,
      ...partial
    };
  }

  prepare(context: ExecutionContext): {
    policy: ExecutionPolicy;
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

    return { policy, messages };
  }

  prepareSubAgentExecution(
    agentName: string,
    task: string,
    toolContext: ToolContext,
    extra?: { excludeTools?: string[] },
    options?: { includeRuntimeContext?: boolean }
  ): {
    policy: ExecutionPolicy;
    messages: ReturnType<AgentExecutor['buildMessages']>;
    toolContext: ToolContext;
  } {
    const policy = this.resolvePolicy(agentName, {
      excludeTools: extra?.excludeTools
    });
    const executor = this.createExecutor(policy, options);
    executor.setCurrentContext(toolContext.channel, toolContext.chatId, toolContext.messageType);
    const messages = executor.buildMessages([], task);

    return {
      policy,
      messages,
      toolContext: {
        ...toolContext,
        agentName: policy.roleName
      }
    };
  }

  prepareTemporarySubAgentExecution(
    baseAgentName: string | undefined,
    task: string,
    systemPrompt: string,
    toolContext: ToolContext,
    extra?: { excludeTools?: string[] },
    options?: { includeRuntimeContext?: boolean }
  ): {
    policy: ExecutionPolicy;
    messages: ReturnType<AgentExecutor['buildMessages']>;
    toolContext: ToolContext;
  } {
    const basePolicy = this.resolvePolicy(baseAgentName, {
      excludeTools: extra?.excludeTools
    });
    const policy: ExecutionPolicy = {
      ...basePolicy,
      systemPrompt
    };
    const executor = this.createExecutor(policy, options);
    executor.setCurrentContext(toolContext.channel, toolContext.chatId, toolContext.messageType);
    const messages = executor.buildMessages([], task);

    return {
      policy,
      messages,
      toolContext: {
        ...toolContext,
        agentName: policy.roleName
      }
    };
  }

  private resolvePolicy(roleName?: string | null, extra?: { excludeTools?: string[] }): ExecutionPolicy {
    if (!this.agentRoleService) {
      if (!this.options.mainModel?.trim()) {
        throw new Error('Main agent model is not configured');
      }
      if (!this.options.defaultProvider) {
        throw new Error('Main agent provider is not configured');
      }

      const allowedToolNames = this.options.toolRegistry.getDefinitions().map((tool) => tool.name);
      return {
        roleName: 'main',
        provider: this.options.defaultProvider,
        model: this.options.mainModel,
        maxContextTokens: undefined,
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
      model: resolveExecutionModel(resolvedRole.model),
      maxContextTokens: this.agentRoleService.getMaxContextTokensForRole(resolvedRole.name),
      systemPrompt: resolvedRole.systemPrompt,
      skillsPrompt: auxiliaryPrompt,
      allowedToolNames,
      toolRegistryView: new ScopedToolRegistry(this.options.toolRegistry, allowedToolNames) as unknown as ToolRegistry,
      visionSettings,
      visionProvider: this.agentRoleService.createVisionProviderForRole(resolvedRole.name),
      maxIterations: this.options.maxIterations,
      memoryWindow: this.options.memoryWindow
    };
  }

  private createExecutor(
    policy: ExecutionPolicy,
    options?: { includeRuntimeContext?: boolean }
  ): AgentExecutor {

    return new AgentExecutor(
      policy.provider,
      policy.toolRegistryView as ToolRegistry,
      this.options.workspace,
      policy.systemPrompt,
      policy.skillsPrompt,
      policy.model,
      policy.maxContextTokens,
      policy.maxIterations,
      this.options.getPluginManager(),
      this.options.executionRegistry,
      options?.includeRuntimeContext ?? true
    );
  }
}
