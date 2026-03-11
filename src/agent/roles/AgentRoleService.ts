import { ConfigLoader } from '../../config/loader.js';
import type { AgentRoleConfig, Config } from '../../types.js';
import type { ToolRegistry } from '../../tools/ToolRegistry.js';
import type { SkillManager } from '../../skills/SkillManager.js';
import { createProvider } from '../../providers/index.js';
import { logger } from '../../logger/index.js';

export interface ResolvedAgentRole extends AgentRoleConfig {
  builtin: boolean;
  availableSkills: string[];
  availableTools: string[];
  missingSkills: string[];
  missingTools: string[];
}

const MAIN_AGENT_NAME = 'main';

export class AgentRoleService {
  private log = logger.child({ prefix: 'AgentRoleService' });

  constructor(
    private getConfig: () => Config,
    private setConfig: (config: Config) => void,
    private toolRegistry: Pick<ToolRegistry, 'getDefinitions' | 'getBlacklist'>,
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
    const roles = [this.buildMainRole(config)];

    for (const [name, role] of Object.entries(config.agents?.roles || {})) {
      if (name === MAIN_AGENT_NAME) {
        continue;
      }
      roles.push(this.resolveRole({ ...role, name }, false));
    }

    return roles;
  }

  getResolvedRole(name?: string | null): ResolvedAgentRole | null {
    const targetName = name || MAIN_AGENT_NAME;
    if (targetName === MAIN_AGENT_NAME) {
      return this.buildMainRole(this.getConfig());
    }

    const role = this.getConfig().agents?.roles?.[targetName];
    if (!role) {
      return null;
    }

    return this.resolveRole({ ...role, name: targetName }, false);
  }

  async createRole(input: AgentRoleConfig): Promise<ResolvedAgentRole> {
    const normalized = this.normalizeRoleConfig(input, false);
    const config = this.getConfig();
    config.agents ||= { roles: {} };

    if (normalized.name === MAIN_AGENT_NAME) {
      throw new Error('Cannot create role using reserved name "main"');
    }
    if (config.agents.roles[normalized.name]) {
      throw new Error(`Agent role already exists: ${normalized.name}`);
    }

    config.agents.roles[normalized.name] = normalized;
    await ConfigLoader.save(config);
    this.setConfig(config);
    return this.resolveRole(normalized, false);
  }

  async updateRole(name: string, input: Partial<AgentRoleConfig>): Promise<ResolvedAgentRole> {
    if (name === MAIN_AGENT_NAME) {
      throw new Error('Cannot update built-in role "main"');
    }

    const config = this.getConfig();
    const existing = config.agents?.roles?.[name];
    if (!existing) {
      throw new Error(`Agent role not found: ${name}`);
    }

    const merged: AgentRoleConfig = {
      ...existing,
      ...input,
      name
    };
    const normalized = this.normalizeRoleConfig(merged, false);
    config.agents ||= { roles: {} };
    config.agents.roles[name] = normalized;
    await ConfigLoader.save(config);
    this.setConfig(config);
    return this.resolveRole(normalized, false);
  }

  async deleteRole(name: string): Promise<void> {
    if (name === MAIN_AGENT_NAME) {
      throw new Error('Cannot delete built-in role "main"');
    }

    const config = this.getConfig();
    if (!config.agents?.roles?.[name]) {
      throw new Error(`Agent role not found: ${name}`);
    }

    delete config.agents.roles[name];
    await ConfigLoader.save(config);
    this.setConfig(config);
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

  getAllowedToolNames(roleName?: string | null, options?: { excludeTools?: string[] }): string[] {
    const role = this.getResolvedRole(roleName);
    if (!role) {
      return [];
    }

    const excluded = new Set(options?.excludeTools || []);
    return role.availableTools.filter((name) => !excluded.has(name));
  }

  createProviderForRole(roleName?: string | null) {
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

  private buildMainRole(config: Config): ResolvedAgentRole {
    const allSkills = (this.skillManager?.listSkills() || []).filter((skill) => skill.enabled).map((skill) => skill.name);
    const allTools = this.toolRegistry.getDefinitions().map((tool) => tool.name);

    return this.resolveRole({
      name: MAIN_AGENT_NAME,
      description: '内建主 Agent',
      systemPrompt: config.agent.defaults.systemPrompt || 'You are a helpful AI assistant.',
      provider: config.agent.defaults.provider,
      model: config.agent.defaults.model,
      allowedSkills: allSkills,
      allowedTools: allTools
    }, true);
  }

  private resolveRole(role: AgentRoleConfig, builtin: boolean): ResolvedAgentRole {
    const availableSkillSet = new Set(
      (this.skillManager?.listSkills() || [])
        .filter((skill) => skill.enabled)
        .map((skill) => skill.name)
    );
    const availableToolSet = new Set(this.toolRegistry.getDefinitions().map((tool) => tool.name));

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
      allowedSkills: [...new Set((input.allowedSkills || []).filter(Boolean))],
      allowedTools: [...new Set((input.allowedTools || []).filter(Boolean))]
    };

    this.log.debug(`Normalized agent role: ${normalized.name}`);
    return normalized;
  }
}
