import { ConfigLoader } from '../../config/loader.js';
import type { AgentRoleConfig, Config, VisionSettings } from '../../types.js';
import type { ToolRegistry } from '../../tools/ToolRegistry.js';
import type { SkillManager } from '../../skills/SkillManager.js';
import { createProvider } from '../../providers/index.js';
import { logger } from '../../observability/index.js';
import type { LLMProvider } from '../../providers/base.js';

export interface ResolvedAgentRole extends AgentRoleConfig {
  builtin: boolean;
  availableSkills: string[];
  availableTools: string[];
  missingSkills: string[];
  missingTools: string[];
}

const MAIN_AGENT_NAME = 'main';

export class AgentRoleService {
  private log = logger.child('AgentRoleService');

  constructor(
    private getConfig: () => Config,
    private setConfig: (config: Config) => void,
    private toolRegistry: Pick<ToolRegistry, 'getDefinitions'>,
    private skillManager?: SkillManager
  ) {}

  getMainAgentName(): string {
    return MAIN_AGENT_NAME;
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

    const nextConfig = await ConfigLoader.update((config) => {
      config.agents.roles[normalized.name] = normalized;
    });
    this.setConfig(nextConfig);
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
    const nextConfig = await ConfigLoader.update((draft) => {
      draft.agents.roles[name] = normalized;
    });
    this.setConfig(nextConfig);
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

    const nextConfig = await ConfigLoader.update((draft) => {
      delete draft.agents.roles[name];
    });
    this.setConfig(nextConfig);
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

    const skillsList = skills
      .map((skill) => `- ${skill.name}: ${skill.description || '无描述'}`)
      .join('\n');

    return [
      '可用 skills：',
      skillsList,
      '需要 skill 时：先用 read_skill 读 SKILL.md；需要更多文件时再用 list_skill_files。'
    ].join('\n');
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
      '当用户任务需要同时进行，或可以拆分为多个可独立编排的子任务时，可使用 call_agent({ items: [{ agentName, task }, ...] }) 一次并发委派多个 Agent，并等待全部完成后统一返回。',
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

  createProviderForRole(roleName?: string | null): LLMProvider {
    const role = this.getResolvedRole(roleName);
    if (!role) {
      throw new Error(`Agent role not found: ${roleName}`);
    }

    const providerConfig = this.getConfig().providers[role.provider];
    if (!providerConfig) {
      throw new Error(`Provider not found for agent role ${role.name}: ${role.provider}`);
    }

    return createProvider(role.provider, providerConfig);
  }

  createVisionProviderForRole(roleName?: string | null): LLMProvider | undefined {
    const role = this.getResolvedRole(roleName);
    if (!role || !role.vision) {
      return undefined;
    }
    if (!role.visionProvider) {
      this.log.warn('Vision provider missing for role', { role: role.name });
      return undefined;
    }
    if (!role.visionModel) {
      this.log.warn('Vision model missing for role', { role: role.name });
      return undefined;
    }

    const providerConfig = this.getConfig().providers[role.visionProvider];
    if (!providerConfig) {
      this.log.warn('Vision provider not found for role', {
        role: role.name,
        provider: role.visionProvider
      });
      return undefined;
    }

    return createProvider(role.visionProvider, providerConfig);
  }

  getVisionSettingsForRole(roleName?: string | null): VisionSettings | undefined {
    const role = this.getResolvedRole(roleName);
    if (!role) {
      return undefined;
    }

    return {
      enabled: role.vision,
      reasoning: role.reasoning,
      visionProviderName: role.visionProvider || undefined,
      visionModelName: role.visionModel || undefined
    };
  }

  private resolveRole(role: AgentRoleConfig, builtin: boolean): ResolvedAgentRole {
    const availableSkillSet = new Set(this.getAvailableSkillNames());
    const availableToolSet = new Set(this.getAvailableToolNames());

    const availableSkills = role.allowedSkills.filter((name) => availableSkillSet.has(name));
    const missingSkills = role.allowedSkills.filter((name) => !availableSkillSet.has(name));
    const availableTools = role.allowedTools.filter((name) => availableToolSet.has(name));
    const missingTools = role.allowedTools.filter((name) => !availableToolSet.has(name));

    return {
      ...role,
      builtin,
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
    if (!input.provider?.trim()) {
      throw new Error('Agent role provider is required');
    }
    if (!input.model?.trim()) {
      throw new Error('Agent role model is required');
    }
    const normalized: AgentRoleConfig = {
      name,
      description: input.description?.trim() || '',
      systemPrompt: input.systemPrompt || 'You are a helpful AI assistant.',
      provider: input.provider.trim(),
      model: input.model.trim(),
      vision: input.vision === true,
      reasoning: input.reasoning === true,
      visionProvider: input.visionProvider?.trim() || '',
      visionModel: input.visionModel?.trim() || '',
      allowedSkills: [...new Set((input.allowedSkills || []).map((item) => item.trim()).filter(Boolean))],
      allowedTools: [...new Set((input.allowedTools || []).map((item) => item.trim()).filter(Boolean))]
    };

    this.log.debug(`Normalized agent role: ${normalized.name}`);
    return normalized;
  }
}
