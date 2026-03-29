import type { AgentRoleConfig, Config, VisionSettings } from '../../../types.js';
import type { ProviderModelConfig } from '../../config/schema/providers.js';
import type { ToolRegistry } from '../../../platform/tools/ToolRegistry.js';
import type { SkillManager } from '../../skills/application/SkillManager.js';
import { createProvider } from '../../../platform/providers/index.js';
import { logger } from '../../../platform/observability/index.js';
import type { LLMProvider } from '../../../platform/providers/base.js';

export interface ResolvedAgentRole extends AgentRoleConfig {
  builtin: boolean;
  provider: string;
  reasoning: boolean;
  vision: boolean;
  availableSkills: string[];
  availableTools: string[];
  missingSkills: string[];
  missingTools: string[];
}

const MAIN_AGENT_NAME = 'main';

interface ParsedModelRef {
  providerName: string;
  modelName: string;
}

interface ResolvedProviderSelection {
  name: string;
  model: string;
  providerConfig: Config['providers'][string] | undefined;
  modelConfig: Config['providers'][string]['models'][string] | undefined;
}

export class AgentRoleService {
  private log = logger.child('AgentRoleService');
  private isPluginLoadingComplete: () => boolean = () => true;

  constructor(
    private getConfig: () => Config,
    private updateConfig: (mutator: (config: Config) => void | Config | Promise<void | Config>) => Promise<Config>,
    private toolRegistry: Pick<ToolRegistry, 'getDefinitions'>,
    private skillManager?: SkillManager,
    private tryParseModelRef: (value?: string | null) => ParsedModelRef | undefined = (value) => {
      if (!value?.trim()) return undefined;
      const trimmed = value.trim();
      const slashIndex = trimmed.indexOf('/');
      if (slashIndex <= 0 || slashIndex === trimmed.length - 1) return undefined;
      const providerName = trimmed.slice(0, slashIndex).trim();
      const modelName = trimmed.slice(slashIndex + 1).trim();
      if (!providerName || !modelName) return undefined;
      return { providerName, modelName };
    },
    private resolveProviderSelection: (config: Config, providerNameOrModelRef?: string, modelName?: string) => ResolvedProviderSelection = (config, providerNameOrModelRef, modelName) => {
      let name = (providerNameOrModelRef || '').trim();
      let resolvedModel = modelName?.trim() || '';
      if (!resolvedModel && name.includes('/')) {
        const slashIndex = name.indexOf('/');
        const providerName = name.slice(0, slashIndex).trim();
        resolvedModel = name.slice(slashIndex + 1).trim();
        name = providerName;
      }
      const providerConfig = config.providers[name];
      return {
        name,
        model: resolvedModel,
        providerConfig,
        modelConfig: providerConfig?.models?.[resolvedModel]
      };
    },
    private formatSkillsPrompt: (skills: Array<{ name: string; description?: string }>) => string = (skills) => {
      if (skills.length === 0) return '';
      const lines = skills.map((skill) => `## ${skill.name}\n${skill.description || ''}`).filter((s) => s.trim());
      return lines.length > 0 ? `\n\nAvailable Skills:\n${lines.join('\n')}\n` : '';
    },
    private defaultSystemPrompt: string = 'You are a helpful AI assistant. Now is {{current_date}}. Running on {{os}}.'
  ) {}

  getMainAgentName(): string {
    return MAIN_AGENT_NAME;
  }

  setPluginLoadingStateResolver(resolver: () => boolean): void {
    this.isPluginLoadingComplete = resolver;
  }

  getDefaultRoleName(): string {
    return MAIN_AGENT_NAME;
  }

  listResolvedRoles(): ResolvedAgentRole[] {
    const config = this.getConfig();
    const mainRole = config.agents.roles[MAIN_AGENT_NAME];
    const roles = [this.resolveRole(mainRole, true)];

    for (const [name, role] of Object.entries(config.agents.roles).sort(([left], [right]) => left.localeCompare(right))) {
      if (name !== MAIN_AGENT_NAME) {
        roles.push(this.resolveRole(role, false));
      }
    }

    return roles;
  }

  getResolvedRole(name?: string | null): ResolvedAgentRole | null {
    const targetName = name || MAIN_AGENT_NAME;
    const role = this.getConfig().agents.roles[targetName];
    if (!role) {
      return null;
    }

    return this.resolveRole(role, targetName === MAIN_AGENT_NAME);
  }

  async createRole(input: AgentRoleConfig): Promise<ResolvedAgentRole> {
    const normalized = this.normalizeRoleConfig(input, false);

    if (normalized.name === MAIN_AGENT_NAME) {
      throw new Error('Cannot create role using reserved name "main"');
    }
    if (this.getConfig().agents.roles[normalized.name]) {
      throw new Error(`Agent role already exists: ${normalized.name}`);
    }

    await this.updateConfig((config) => {
      config.agents.roles[normalized.name] = normalized;
    });
    return this.resolveRole(normalized, false);
  }

  async updateRole(name: string, input: Partial<AgentRoleConfig>): Promise<ResolvedAgentRole> {
    const config = this.getConfig();
    const existing = config.agents.roles[name];
    if (!existing) {
      throw new Error(`Agent role not found: ${name}`);
    }

    const merged: AgentRoleConfig = {
      ...existing,
      ...input,
      name
    };
    const normalized = this.normalizeRoleConfig(merged, name === MAIN_AGENT_NAME);
    await this.updateConfig((draft) => {
      draft.agents.roles[name] = normalized;
    });
    return this.resolveRole(normalized, name === MAIN_AGENT_NAME);
  }

  async deleteRole(name: string): Promise<void> {
    if (name === MAIN_AGENT_NAME) {
      throw new Error('Cannot delete built-in role "main"');
    }

    const config = this.getConfig();
    if (!config.agents.roles[name]) {
      throw new Error(`Agent role not found: ${name}`);
    }

    await this.updateConfig((draft) => {
      delete draft.agents.roles[name];
    });
  }

  buildSkillsPrompt(roleName?: string | null): string {
    const role = this.getResolvedRole(roleName);
    if (!role || role.availableSkills.length === 0) {
      return '';
    }

    const skills = role.availableSkills
      .map((name) => this.skillManager?.getSkill(name))
      .filter((skill): skill is NonNullable<typeof skill> => !!skill)
      .filter((skill) => skill.enabled);

    if (skills.length === 0) {
      return '';
    }

    return this.formatSkillsPrompt(skills);
  }

  buildRoleDescriptionsPrompt(roleName?: string | null): string {
    const targetName = roleName || MAIN_AGENT_NAME;
    if (targetName !== MAIN_AGENT_NAME) {
      return '';
    }

    const roles = this.listResolvedRoles().filter((role) => role.name !== MAIN_AGENT_NAME);
    if (roles.length === 0) {
      return '';
    }

    const roleList = roles
      .map((role) => `- ${role.name}: ${(role.description || '无描述').trim() || '无描述'}`)
      .join('\n');

    return [
      '可调用的 Agent 角色：',
      '任务可并行处理或可拆分为独立子任务时，可使用 call_agent({ items: [{ agentName, task }, ...] }) 并发委派多个 Agent。',
      '也可使用 call_temp_agent({ items: [{ task, systemPrompt }, ...] }) 基于当前 Agent 创建一个或多个一次性临时分身，并发执行独立子任务；它只临时覆写 systemPrompt，不写入配置。',
      roleList
    ].join('\n');
  }

  getAllowedToolNames(roleName?: string | null, options?: { excludeTools?: string[] }): string[] {
    const role = this.getResolvedRole(roleName);
    if (!role) {
      return [];
    }

    const excluded = new Set(options?.excludeTools || []);
    return role.availableTools.filter((name) => !excluded.has(name));
  }

  getMaxContextTokensForRole(roleName?: string | null): number | undefined {
    const role = this.getResolvedRole(roleName);
    if (!role) {
      return undefined;
    }

    return (this.resolveRoleModelSelection(roleName)?.modelConfig as ProviderModelConfig | undefined)?.maxContextTokens;
  }

  createProviderForRole(roleName?: string | null): LLMProvider {
    const role = this.getResolvedRole(roleName);
    if (!role) {
      throw new Error(`Agent role not found: ${roleName}`);
    }
    if (!role.model?.trim()) {
      throw new Error(`Agent role model is not configured: ${role.name}`);
    }

    const selection = this.resolveRoleModelSelection(roleName);
    const providerConfig = selection?.providerConfig;
    if (!providerConfig) {
      throw new Error(`Provider not found for agent role ${role.name}: ${selection?.name || '(missing)'}`);
    }

    return createProvider(selection!.name, providerConfig);
  }

  createVisionProviderForRole(roleName?: string | null): LLMProvider | undefined {
    const settings = this.getVisionSettingsForRole(roleName);
    if (!settings || !settings.fallbackProviderName || !settings.fallbackModelName) {
      return undefined;
    }

    const providerConfig = this.getConfig().providers[settings.fallbackProviderName];
    if (!providerConfig) {
      return undefined;
    }

    return createProvider(settings.fallbackProviderName, providerConfig);
  }

  getVisionSettingsForRole(roleName?: string | null): VisionSettings | undefined {
    const selection = this.resolveRoleModelSelection(roleName);
    if (!selection) {
      return undefined;
    }

    const directVision = (selection.modelConfig as ProviderModelConfig | undefined)?.supportsVision === true;
    const fallbackSelection = this.resolveVisionFallbackSelection();

    return {
      enabled: directVision || !!fallbackSelection,
      directVision,
      reasoning: (fallbackSelection?.modelConfig as ProviderModelConfig | undefined)?.reasoning === true,
      fallbackModelRef: fallbackSelection ? `${fallbackSelection.name}/${fallbackSelection.model}` : undefined,
      fallbackProviderName: fallbackSelection?.name,
      fallbackModelName: fallbackSelection?.model
    };
  }

  private resolveRole(role: AgentRoleConfig, builtin: boolean): ResolvedAgentRole {
    const availableSkillSet = new Set(this.getAvailableSkillNames());
    const availableToolSet = new Set(this.getAvailableToolNames());
    const pluginLoadingComplete = this.isPluginLoadingComplete();
    const selection = this.resolveProviderSelection(this.getConfig(), role.model);
    const hasVisionFallback = !!this.resolveVisionFallbackSelection();

    const availableSkills = role.allowedSkills.filter((name) => availableSkillSet.has(name));
    const missingSkills = role.allowedSkills.filter((name) => !availableSkillSet.has(name));
    const availableTools = role.allowedTools.filter((name) => availableToolSet.has(name));
    const missingTools = pluginLoadingComplete
      ? role.allowedTools.filter((name) => !availableToolSet.has(name))
      : [];

    return {
      ...role,
      builtin,
      provider: selection.name,
      reasoning: (selection.modelConfig as ProviderModelConfig | undefined)?.reasoning === true,
      vision: (selection.modelConfig as ProviderModelConfig | undefined)?.supportsVision === true || hasVisionFallback,
      availableSkills,
      availableTools,
      missingSkills,
      missingTools
    };
  }

  private getAvailableSkillNames(): string[] {
    return (this.skillManager?.listSkills() || [])
      .filter((skill) => skill.enabled)
      .map((skill) => skill.name);
  }

  private getAvailableToolNames(): string[] {
    return this.toolRegistry.getDefinitions().map((tool) => tool.name);
  }

  private normalizeRoleConfig(input: AgentRoleConfig, builtin: boolean): AgentRoleConfig {
    const name = input.name.trim();
    if (!name) {
      throw new Error('Agent role name is required');
    }
    if (!builtin && name === MAIN_AGENT_NAME) {
      throw new Error('Name "main" is reserved');
    }
    if (!input.model?.trim()) {
      throw new Error('Agent role model is required');
    }
    this.tryParseModelRef(input.model);
    const normalized: AgentRoleConfig = {
      name,
      description: input.description?.trim() || '',
      systemPrompt: input.systemPrompt || this.defaultSystemPrompt,
      model: input.model.trim(),
      allowedSkills: [...new Set((input.allowedSkills || []).map((item) => item.trim()).filter(Boolean))],
      allowedTools: [...new Set((input.allowedTools || []).map((item) => item.trim()).filter(Boolean))]
    };
    return normalized;
  }

  private resolveRoleModelSelection(roleName?: string | null) {
    const role = this.getResolvedRole(roleName);
    if (!role) {
      return undefined;
    }

    return this.resolveProviderSelection(this.getConfig(), role.model);
  }

  private resolveVisionFallbackSelection() {
    const fallbackRef = this.getConfig().agent.defaults.visionFallbackModel?.trim();
    if (!fallbackRef) {
      return undefined;
    }

    return this.resolveProviderSelection(this.getConfig(), fallbackRef);
  }
}