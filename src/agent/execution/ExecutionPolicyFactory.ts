import type { VisionSettings } from '../../types.js';
import type { LLMProvider } from '../../providers/base.js';
import type { PluginManager } from '../../plugins/index.js';
import type { ToolRegistry } from '../../tools/ToolRegistry.js';
import type { AgentRoleService } from '../roles/AgentRoleService.js';
import { AgentExecutor } from './engine/AgentExecutor.js';
import { ScopedToolRegistry } from '../../tools/ScopedToolRegistry.js';
import { logger } from '../../logger/index.js';
import type { ExecutionPolicy } from './contracts.js';
import type { ExecutionRegistry } from './ExecutionRegistry.js';

export interface ExecutionPolicyFactoryOptions {
  defaultProvider: LLMProvider;
  defaultModel: string;
  defaultSystemPrompt: string;
  maxIterations: number;
  memoryWindow: number;
  toolRegistry: ToolRegistry;
  workspace: string;
  pluginManager?: PluginManager;
  visionSettings?: VisionSettings;
  visionProvider?: LLMProvider;
  executionRegistry: ExecutionRegistry;
}

export class ExecutionPolicyFactory {
  private log = logger.child({ prefix: 'ExecutionPolicyFactory' });

  constructor(
    private options: ExecutionPolicyFactoryOptions,
    private agentRoleService?: AgentRoleService
  ) {}

  updateRuntime(partial: Partial<Pick<ExecutionPolicyFactoryOptions, 'defaultProvider' | 'defaultModel' | 'defaultSystemPrompt' | 'maxIterations' | 'memoryWindow' | 'pluginManager' | 'visionSettings' | 'visionProvider'>>): void {
    this.options = {
      ...this.options,
      ...partial
    };
  }

  createPolicy(roleName?: string | null, extra?: { excludeTools?: string[] }): ExecutionPolicy {
    if (!this.agentRoleService) {
      const allowedToolNames = this.options.toolRegistry.getDefinitions().map((tool) => tool.name);
      return {
        roleName: 'main',
        provider: this.options.defaultProvider,
        model: this.options.defaultModel,
        systemPrompt: this.options.defaultSystemPrompt,
        skillsPrompt: '',
        allowedToolNames,
        toolRegistryView: this.options.toolRegistry,
        visionSettings: this.options.visionSettings,
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

    const auxiliaryPrompt = [
      this.agentRoleService.buildSkillsPrompt(resolvedRole.name),
      this.agentRoleService.buildRoleDescriptionsPrompt(resolvedRole.name)
    ].filter((section) => typeof section === 'string' && section.trim().length > 0).join('\n\n');

    return {
      roleName: resolvedRole.name,
      provider: this.agentRoleService.createProviderForRole(resolvedRole.name),
      model: resolvedRole.model,
      systemPrompt: resolvedRole.systemPrompt,
      skillsPrompt: auxiliaryPrompt,
      allowedToolNames,
      toolRegistryView: new ScopedToolRegistry(this.options.toolRegistry, allowedToolNames) as unknown as ToolRegistry,
      visionSettings: this.options.visionSettings,
      maxIterations: this.options.maxIterations,
      memoryWindow: this.options.memoryWindow
    };
  }

  createExecutor(policy: ExecutionPolicy): AgentExecutor {
    this.log.debug(`Creating executor for role=${policy.roleName}, model=${policy.model}`);

    return new AgentExecutor(
      policy.provider,
      policy.toolRegistryView as ToolRegistry,
      this.options.workspace,
      policy.systemPrompt,
      policy.skillsPrompt,
      policy.model,
      policy.maxIterations,
      this.options.pluginManager,
      policy.visionSettings,
      this.options.visionProvider,
      this.options.executionRegistry
    );
  }
}
