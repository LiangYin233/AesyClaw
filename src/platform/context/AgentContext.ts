// src/platform/context/AgentContext.ts
import type { AgentRoleConfig, VisionSettings } from '../../types.js';
import type { LLMProvider } from '../providers/base.js';

export interface ResolvedAgentRole {
  name: string;
  builtin: boolean;
  provider: string;
  reasoning: boolean;
  vision: boolean;
  description?: string;
  model: string;
  systemPrompt: string;
  availableSkills: string[];
  availableTools: string[];
  missingSkills: string[];
  missingTools: string[];
}

export interface AgentRoleService {
  getMainAgentName(): string;
  getDefaultRoleName(): string;
  listResolvedRoles(): ResolvedAgentRole[];
  getResolvedRole(name?: string | null): ResolvedAgentRole | null;
  getAllowedToolNames(roleName?: string | null, options?: { excludeTools?: string[] }): string[];
  getMaxContextTokensForRole(roleName?: string | null): number | undefined;
  buildSkillsPrompt(roleName?: string | null): string;
  buildRoleDescriptionsPrompt(roleName?: string | null): string;
  createRole(input: AgentRoleConfig): Promise<ResolvedAgentRole>;
  updateRole(name: string, input: Partial<AgentRoleConfig>): Promise<ResolvedAgentRole>;
  deleteRole(name: string): Promise<void>;
  getVisionSettingsForRole(roleName?: string | null): VisionSettings | undefined;
  createProviderForRole(roleName?: string | null): LLMProvider;
  createVisionProviderForRole(roleName?: string | null): LLMProvider | undefined;
}

export interface AgentContext {
  agentRoleService: AgentRoleService;
}
