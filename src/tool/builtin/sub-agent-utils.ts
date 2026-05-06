import { randomUUID } from 'node:crypto';
import type { RoleConfig } from '@aesyclaw/core/types';

const BLOCKED_TOOLS = ['run_sub_agent', 'run_temp_sub_agent'];

export function applyToolOverride(role: RoleConfig, enableTools?: boolean): RoleConfig {
  if (enableTools === false) {
    return { ...role, toolPermission: { mode: 'allowlist', list: [] } };
  }

  const { mode, list } = role.toolPermission;

  if (mode === 'allowlist') {
    return list.includes('*')
      ? { ...role, toolPermission: { mode: 'denylist' as const, list: BLOCKED_TOOLS } }
      : {
          ...role,
          toolPermission: {
            mode: 'allowlist' as const,
            list: list.filter((name) => !BLOCKED_TOOLS.includes(name)),
          },
        };
  }

  return {
    ...role,
    toolPermission: {
      mode: 'denylist' as const,
      list: [...new Set([...list, ...BLOCKED_TOOLS])],
    },
  };
}

export function createTempSubAgentRole(
  baseRole: RoleConfig,
  params: { systemPrompt: string; model?: string },
  toolPermission?: RoleConfig['toolPermission'],
): RoleConfig {
  return {
    ...baseRole,
    toolPermission: toolPermission ?? baseRole.toolPermission,
    id: `temp-sub-agent-${randomUUID()}`,
    description: 'Temporary delegated agent execution',
    systemPrompt: params.systemPrompt,
    model: params.model ?? baseRole.model,
    enabled: true,
  };
}
